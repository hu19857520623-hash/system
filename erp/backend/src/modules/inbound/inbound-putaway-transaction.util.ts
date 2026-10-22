import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { InventoryMutationService } from '../../common/inventory/inventory-mutation.service'
import { inboundMeasurementVersion } from './inbound-receiving-version.util'
import { writeInboundActualToCatalog } from '../pricing/catalog-sync.util'
import type { PutawayInboundDto } from './dto/inbound-putaway.dto'
import { attachInboundWorkflowRevision, INBOUND_WAREHOUSE_ACTIONS } from './inbound-workflow-revision.util'

export function normalizePutawayInput(id: number, payload: PutawayInboundDto) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new BadRequestException('入库单编号无效，请返回列表重新选择')
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(payload?.clientRequestId || '')) throw new BadRequestException('请提供有效的上架操作标识，重新打开作业页面后重试')
  if (!/^[a-f0-9]{64}$/.test(payload.expectedVersion || '')) throw new BadRequestException('请重新读取最新实收与测量进度后上架')
  if (!Array.isArray(payload.items) || !payload.items.length) throw new BadRequestException('请提供上架明细')
  const ids = new Set<number>()
  const items = payload.items.map(group => {
    if (!group || !Number.isSafeInteger(group.inboundItemId) || group.inboundItemId <= 0 || ids.has(group.inboundItemId)) throw new BadRequestException('上架明细编号无效或重复，请重新读取')
    ids.add(group.inboundItemId)
    if (!Array.isArray(group.lines) || !group.lines.length) throw new BadRequestException('请逐条填写实际库位与上架数量')
    const locations = new Set<string>()
    const lines = group.lines.map(line => {
      if (!line || typeof line.locationCode !== 'string' || !line.locationCode.trim() || line.locationCode.trim().length > 30) throw new BadRequestException('请填写有效的实际库位')
      const locationCode = line.locationCode.trim().toUpperCase()
      if (locations.has(locationCode)) throw new BadRequestException('同一明细的库位重复，请合并数量后提交')
      locations.add(locationCode)
      if (typeof line.qty !== 'number' || !Number.isSafeInteger(line.qty) || line.qty <= 0 || line.qty > 2147483647) throw new BadRequestException('上架数量须为大于零且未超出范围的整数')
      return { locationCode, qty: line.qty }
    }).sort((a, b) => a.locationCode.localeCompare(b.locationCode))
    return { inboundItemId: group.inboundItemId, lines }
  }).sort((a, b) => a.inboundItemId - b.inboundItemId)
  return { id, expectedVersion: payload.expectedVersion, items }
}

/** Parent/product/inventory locks protect the receipt limit and absolute inventory helpers. */
export async function runInboundPutaway(prisma: PrismaService, inventory: InventoryMutationService, id: number, payload: PutawayInboundDto, operatorId?: number) {
  if (!Number.isSafeInteger(operatorId) || !operatorId || operatorId <= 0) throw new ForbiddenException('请重新登录后上架')
  const request = normalizePutawayInput(id, payload), fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex')
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(operatorId)} FOR UPDATE`
    const previous = await tx.operationLog.findFirst({ where: { operatorId: BigInt(operatorId), module: 'inbound', action: { in: INBOUND_WAREHOUSE_ACTIONS }, detail: { path: '$.clientRequestId', equals: payload.clientRequestId } } })
    if (previous) {
      const detail = previous.detail as any
      if (detail.requestFingerprint !== fingerprint) throw new ConflictException('原上架操作对应的内容不同，请先核对原操作，不要修改后重试')
      return { ...detail.response, duplicate: true, message: '原上架操作已处理，本次未重复加库存，请按最新单据继续' }
    }
    await tx.$queryRaw`SELECT id FROM inbound_order WHERE id = ${BigInt(id)} FOR UPDATE`
    const order = await tx.inboundOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true, cartons: true } })
    if (!order) throw new NotFoundException('入库单不存在，请返回列表重新读取')
    await attachInboundWorkflowRevision(tx, order)
    if (['completed', 'confirmed', 'cancelled'].includes(order.status)) throw new BadRequestException('该入库单已完结')
    if (order.status !== 'pending_putaway') {
      const labels: Record<string, string> = { receiving: '收货中', arrived: '已到仓', exception: '异常', pending_receipt: '在途' }
      throw new BadRequestException(`当前状态「${labels[order.status] || '待核对'}」不可上架，请先完成清点${order.status === 'exception' ? '与异常处理' : ''}`)
    }
    if (!order.items.length || order.items.some(line => !Number.isSafeInteger(line.actualQty) || line.actualQty! < 0)) throw new BadRequestException('全部明细须明确完成实收清点后才能上架，请返回清点核对')
    const warehouse = await tx.warehouse.findUnique({ where: { warehouseCode: order.warehouseCode } })
    if (!warehouse || warehouse.status !== 1 || warehouse.warehouseType !== 'wms') throw new BadRequestException('目的海外仓无效或已停用，请联系主管核对')
    const ids = [...new Set(order.items.map(line => line.productId))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    for (const productId of ids) await tx.$queryRaw`SELECT id FROM product WHERE id = ${productId} FOR UPDATE`
    const products = await tx.product.findMany({ where: { id: { in: ids } } }), byId = new Map(products.map(product => [String(product.id), product]))
    if (inboundMeasurementVersion(order, products) !== request.expectedVersion) throw new ConflictException('实收、已上架数量或实测尺寸已变更，请重新读取最新进度后上架')
    const resolved = request.items.map(group => {
      const item = order.items.find(line => Number(line.id) === group.inboundItemId)
      if (!item) throw new BadRequestException('上架明细不属于本单，请重新读取原单')
      const total = group.lines.reduce((sum, line) => sum + line.qty, 0), remaining = item.actualQty! - (item.putawayQty || 0)
      if (!Number.isSafeInteger(total) || total > remaining) throw new BadRequestException(`${item.sku} 上架数量超出实收剩余 ${Math.max(0, remaining)} 件`)
      const product = byId.get(String(item.productId))
      if (!product || product.sku !== item.sku) throw new BadRequestException('商品档案与入库明细不一致，请联系主管核对')
      if (![product.measuredLengthCm, product.measuredWidthCm, product.measuredHeightCm].every(value => value != null && Number.isFinite(Number(value)) && Number(value) > 0)) throw new BadRequestException(`${item.sku} 上架前须先保存完整实测尺寸，请返回清点与测量`)
      return { group, item, total }
    })
    const codes = [...new Set(request.items.flatMap(group => group.lines.map(line => line.locationCode)))].sort()
    const locations = await tx.warehouseLocation.findMany({ where: { warehouseCode: order.warehouseCode, locationCode: { in: codes } }, include: { zone: true }, orderBy: { id: 'asc' } })
    for (const location of locations) await tx.$queryRaw`SELECT id FROM warehouse_location WHERE id = ${location.id} FOR UPDATE`
    const zoneIds = [...new Set(locations.map(location => location.zoneId))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    for (const zoneId of zoneIds) await tx.$queryRaw`SELECT id FROM warehouse_zone WHERE id = ${zoneId} FOR UPDATE`
    // Re-read after locks: a location may have been disabled while waiting.
    const freshLocations = await tx.warehouseLocation.findMany({ where: { warehouseCode: order.warehouseCode, locationCode: { in: codes } }, include: { zone: true } })
    const locationByCode = new Map(freshLocations.map(location => [location.locationCode.toUpperCase(), location]))
    for (const code of codes) {
      const location = locationByCode.get(code)
      if (!location || location.status !== 'available' || location.zone?.status !== 1 || location.zone.warehouseCode !== order.warehouseCode) throw new BadRequestException(`库位 ${code} 不可用、已停用或不属于目的仓，请重新选择`)
    }
    for (const productId of ids) await tx.$queryRaw`SELECT id FROM inventory WHERE product_id = ${productId} AND warehouse_code = ${order.warehouseCode} FOR UPDATE`
    for (const productId of ids) {
      const current = await tx.inventory.findUnique({ where: { productId_warehouseCode: { productId, warehouseCode: order.warehouseCode } } })
      const addition = resolved.filter(row => row.item.productId === productId).reduce((sum, row) => sum + row.total, 0)
      if ((current?.totalQty || 0) + addition > 2147483647 || (current?.availableQty || 0) + addition > 2147483647) throw new BadRequestException('上架后的仓库数量超出支持范围，请联系主管核对')
    }
    let processedQty = 0
    for (const { group, item, total } of resolved) {
      for (const line of group.lines) {
        const location = locationByCode.get(line.locationCode)!
        await tx.inboundPutawayItem.create({ data: { inboundId: order.id, inboundItemId: item.id, locationId: location.id, locationCode: location.locationCode, qty: line.qty, operatorId: BigInt(operatorId) } })
        await inventory.addLocationStock(tx, { productId: item.productId, sku: item.sku, warehouseCode: order.warehouseCode, locationId: location.id, locationCode: location.locationCode, qty: line.qty, inboundNo: order.inboundNo, batchNo: order.inboundNo,
          costRmb: item.costRmb != null ? Number(item.costRmb) : undefined, seaFreightPerUnit: item.seaFreightPerUnit != null ? Number(item.seaFreightPerUnit) : undefined, domesticFeePerUnit: item.domesticFeePerUnit != null ? Number(item.domesticFeePerUnit) : undefined },
        { changeType: 'putaway', operatorId, referenceNo: order.inboundNo, remark: location.locationCode })
      }
      item.putawayQty = (item.putawayQty || 0) + total; processedQty += total
      await tx.inboundOrderItem.update({ where: { id: item.id }, data: { putawayQty: item.putawayQty } })
    }
    const remainingQty = order.items.reduce((sum, item) => sum + Math.max(0, item.actualQty! - (item.putawayQty || 0)), 0), allDone = remainingQty === 0
    if (allDone) {
      await tx.inboundOrder.update({ where: { id: order.id }, data: { status: 'completed', putawayAt: new Date(), putawayBy: BigInt(operatorId), confirmedAt: new Date(), confirmedBy: BigInt(operatorId) } })
      await writeInboundActualToCatalog(tx, { inboundNo: order.inboundNo, lines: order.items.map(item => ({ sku: item.sku, actualQty: item.actualQty! })) })
    }
    const response = { id, inboundNo: order.inboundNo, warehouseCode: order.warehouseCode, omsCustomerCode: order.omsCustomerCode, allDone, status: allDone ? 'completed' : 'pending_putaway', processedQty, remainingQty,
      items: order.items.map(item => ({ id: Number(item.id), sku: item.sku, actualQty: item.actualQty, putawayQty: item.putawayQty })),
      message: allDone ? `本单已全部上架完成，共确认本次 ${processedQty} 件` : `本次已上架 ${processedQty} 件，剩余 ${remainingQty} 件，请继续上架` }
    await tx.operationLog.create({ data: { operatorId: BigInt(operatorId), module: 'inbound', action: 'putaway', targetType: 'inbound_order', targetId: order.inboundNo, detail: JSON.parse(JSON.stringify({ clientRequestId: payload.clientRequestId, requestFingerprint: fingerprint, request, response })) } })
    return { ...response, duplicate: false }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20000 })
}
