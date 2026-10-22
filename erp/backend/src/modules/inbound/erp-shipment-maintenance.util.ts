import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import type { PrismaService } from '../../common/prisma/prisma.service'
import { catalogSkuLookupKeys } from '../../common/catalog-customer.util'
import { unitCostRmb } from '../../common/inventory/inventory-lot-cost.util'
import { writeInboundSeaFreightToCatalog } from '../pricing/catalog-sync.util'
import { inboundReceivingStarted } from './inbound-delete.util'
import { assertErpShipment, shipmentBillingDimensions, shipmentSeaFreightVersion } from './erp-shipment-edit.util'
import { allocateInboundSeaFreight, patchInboundRemarkSeaFreight } from './inbound-sea-freight.util'
import type { ApplyShipmentFreightDto, ShipmentFreightMutationDto } from './dto/erp-shipment.dto'

function requireOperator(operatorId?: number): number {
  if (!Number.isSafeInteger(operatorId) || !operatorId || operatorId <= 0) throw new ForbiddenException('请重新登录后操作发运单')
  return operatorId
}
const sortedProductIds = (items: { productId: bigint }[]) => [...new Set(items.map(item => item.productId))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
const jsonCopy = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, value) => typeof value === 'bigint' ? Number(value) : value))

async function latestOtherShipment(tx: Prisma.TransactionClient, productId: bigint, excludedId: bigint) {
  return tx.inboundOrderItem.findFirst({ where: { productId, order: { id: { not: excludedId }, sourceWarehouseCode: { notIn: [''] }, omsCustomerCode: null, status: { not: 'cancelled' } } },
    include: { order: true }, orderBy: [{ order: { createdAt: 'desc' } }, { id: 'desc' }] })
}

export async function removeErpShipment(prisma: PrismaService, id: number, operatorId?: number) {
  const ownerId = requireOperator(operatorId)
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM inbound_order WHERE id = ${BigInt(id)} FOR UPDATE`
    const order = await tx.inboundOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true, cartons: { include: { items: true } } } })
    if (!order) {
      const previous = await tx.operationLog.findFirst({ where: { module: 'inbound', action: 'delete', detail: { path: '$.inboundId', equals: id } } })
      if (previous) return { ok: true, inboundNo: previous.targetId, duplicate: true, deletedOrder: (previous.detail as any)?.deletedOrder }
      throw new NotFoundException('入库单不存在，请返回列表重新读取')
    }
    assertErpShipment(order)
    if (inboundReceivingStarted(order)) throw new BadRequestException('已开始收货的入库单不能删除，请返回查看仓库作业进度')
    if (!order.items.length || order.items.some(item => !item.sku || item.expectedQty <= 0)) throw new BadRequestException('发运明细不完整，请先核对原始扣减记录，不能自动返还库存')
    const ids = sortedProductIds(order.items)
    for (const productId of ids) {
      await tx.$queryRaw`SELECT id FROM product WHERE id = ${productId} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM inventory WHERE product_id = ${productId} AND warehouse_code = ${order.sourceWarehouseCode!} FOR UPDATE`
    }
    const products = await tx.product.findMany({ where: { id: { in: ids } } })
    if (products.length !== ids.length) throw new BadRequestException('关联商品档案不完整，请联系主管核对，不能自动返还库存')
    const productById = new Map(products.map(product => [product.id, product]))
    const allocations = await tx.inventoryLog.findMany({ where: { referenceNo: order.inboundNo, warehouseCode: order.sourceWarehouseCode!, changeType: 'inbound_allocate' } })
    for (const productId of ids) {
      const lines = order.items.filter(item => item.productId === productId)
      const qty = lines.reduce((sum, item) => sum + item.expectedQty, 0)
      const allocated = -allocations.filter(log => log.productId === productId).reduce((sum, log) => sum + log.changeQty, 0)
      if (allocated !== qty) throw new BadRequestException(`${lines[0].sku} 原始扣减流水与发运数量不一致，请联系主管核对，不能自动返还库存`)
      const stock = await tx.inventory.findUnique({ where: { productId_warehouseCode: { productId, warehouseCode: order.sourceWarehouseCode! } } })
      if (stock) await tx.inventory.update({ where: { id: stock.id }, data: { totalQty: { increment: qty }, availableQty: { increment: qty } } })
      else await tx.inventory.create({ data: { productId, sku: lines[0].sku, warehouseCode: order.sourceWarehouseCode!, totalQty: qty, availableQty: qty, lockedQty: 0 } })
      await tx.inventoryLog.create({ data: { productId, sku: lines[0].sku, warehouseCode: order.sourceWarehouseCode!, changeType: 'inbound_release', changeQty: qty,
        beforeQty: stock?.totalQty || 0, afterQty: (stock?.totalQty || 0) + qty, referenceNo: order.inboundNo, operatorId: BigInt(ownerId), remark: '删除未收货发运单，退回中转仓良品库存' } })
      const pricing = await tx.productPricing.findFirst({ where: { sku: { in: catalogSkuLookupKeys(lines[0].sku) }, inboundNo: order.inboundNo } })
      if (pricing) {
        const previous = await latestOtherShipment(tx, productId, order.id)
        await tx.productPricing.update({ where: { id: pricing.id }, data: { inboundNo: previous?.order.inboundNo || null,
          inboundQty: previous ? Number(previous.actualQty ?? previous.expectedQty) : 0,
          seaFreight: Number(previous?.seaFreightPerUnit || 0), ...(previous?.costRmb != null ? { costRmb: previous.costRmb } : {}),
          ...(previous?.domesticFeePerUnit != null ? { domesticFee: previous.domesticFeePerUnit } : {}) } })
        await tx.productPricingHistory.create({ data: { pricingId: pricing.id, operatorRole: '系统', action: '发运单删除回退',
          detail: `删除 ${order.inboundNo}，发运资料回退至 ${previous?.order.inboundNo || '无待关联发运单'}；保留现有销售及可见库存设置` } })
        await tx.product.update({ where: { id: productId }, data: { seaFreightPerUnit: Number(previous?.seaFreightPerUnit || 0) } })
      }
    }
    const deletedOrder = jsonCopy({ ...order, items: order.items.map(item => ({ ...item, productName: productById.get(item.productId)?.productName || '',
      spec: productById.get(item.productId)?.spec || '', ...shipmentBillingDimensions(productById.get(item.productId)), weightKg: Number(productById.get(item.productId)?.weightKg || 0) })) })
    await tx.inboundArrivalScan.deleteMany({ where: { inboundId: order.id } })
    await tx.inboundPutawayItem.deleteMany({ where: { inboundId: order.id } })
    await tx.inboundCartonItem.deleteMany({ where: { cartonId: { in: order.cartons.map(carton => carton.id) } } })
    await tx.inboundCarton.deleteMany({ where: { inboundId: order.id } })
    await tx.inboundOrderItem.deleteMany({ where: { inboundId: order.id } })
    await tx.$executeRawUnsafe('DELETE FROM inbound_attachment WHERE inbound_id = ?', Number(order.id))
    await tx.inboundOrder.delete({ where: { id: order.id } })
    await tx.operationLog.create({ data: { operatorId: BigInt(ownerId), module: 'inbound', action: 'delete', targetType: 'inbound_order', targetId: order.inboundNo,
      detail: { inboundId: id, sourceWarehouseCode: order.sourceWarehouseCode, destWarehouseCode: order.warehouseCode, restoredQty: order.items.reduce((sum, item) => sum + item.expectedQty, 0), deletedOrder } } })
    return { ok: true, inboundNo: order.inboundNo, duplicate: false, deletedOrder }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 })
}

export async function writeErpShipmentFreight(prisma: PrismaService, id: number, body: ShipmentFreightMutationDto | ApplyShipmentFreightDto, clear: boolean, operatorId?: number) {
  const ownerId = requireOperator(operatorId)
  const input = body as ApplyShipmentFreightDto
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input?.clientRequestId || '') || !/^[a-f0-9]{64}$/.test(input?.expectedVersion || '')) throw new BadRequestException('请重新读取最新入库单详情后再修改海运费')
  if (!clear && (!['lcl', 'fcl'].includes(input.mode) || typeof input.totalAmount !== 'number' || !Number.isFinite(input.totalAmount) || input.totalAmount <= 0 || input.totalAmount > 9999999999.99 || Math.abs(input.totalAmount * 100 - Math.round(input.totalAmount * 100)) > 0.0001)) throw new BadRequestException('请选择运输方式，海运费总额须为大于零且最多两位小数的有效金额')
  const next = clear ? null : { mode: input.mode, totalAmount: input.totalAmount }
  const fingerprint = createHash('sha256').update(JSON.stringify({ id, next, expectedVersion: input.expectedVersion })).digest('hex')
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(ownerId)} FOR UPDATE`
    const previous = await tx.operationLog.findFirst({ where: { operatorId: BigInt(ownerId), module: 'inbound', action: { in: ['sea_freight_backfill', 'sea_freight_clear'] }, detail: { path: '$.clientRequestId', equals: input.clientRequestId } } })
    if (previous) {
      if ((previous.detail as any)?.requestFingerprint !== fingerprint) throw new ConflictException('本次海运费操作已用于其他内容，请先核对原操作，请勿重复修改')
      return { id, inboundNo: previous.targetId!, duplicate: true, committed: true }
    }
    await tx.$queryRaw`SELECT id FROM inbound_order WHERE id = ${BigInt(id)} FOR UPDATE`
    const order = await tx.inboundOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true } })
    if (!order) throw new NotFoundException('入库单不存在，请返回列表重新读取')
    assertErpShipment(order)
    if (order.status === 'cancelled') throw new BadRequestException('已作废的入库单不能修改海运费')
    const ids = sortedProductIds(order.items)
    for (const productId of ids) await tx.$queryRaw`SELECT id FROM product WHERE id = ${productId} FOR UPDATE`
    const products = await tx.product.findMany({ where: { id: { in: ids } } })
    if (shipmentSeaFreightVersion(order, products) !== input.expectedVersion) throw new ConflictException('单据、商品尺寸或海运费已变更，请重新读取最新详情后再提交')
    const byId = new Map(products.map(product => [product.id, product]))
    const lines = order.items.map(item => ({ ...item, ...shipmentBillingDimensions(byId.get(item.productId)) }))
    if (!lines.length || lines.some(line => line.expectedQty <= 0)) throw new BadRequestException('发运数量不完整，请先核对入库单明细')
    if (next && lines.some(line => ![line.lengthCm, line.widthCm, line.heightCm].every(value => value != null && value > 0))) throw new BadRequestException('请先补齐全部商品的有效长宽高，再分摊海运费')
    const allocated = allocateInboundSeaFreight(lines, next?.totalAmount || 0)
    for (const line of allocated) {
      await tx.inboundOrderItem.update({ where: { id: line.id }, data: { seaFreightPerUnit: line.unitFreight } })
      const latest = await tx.inboundOrderItem.findFirst({ where: { productId: line.productId, order: { sourceWarehouseCode: { notIn: [''] }, omsCustomerCode: null, status: { not: 'cancelled' } } }, include: { order: true }, orderBy: [{ order: { createdAt: 'desc' } }, { id: 'desc' }] })
      if (latest?.inboundId === order.id) await tx.product.update({ where: { id: line.productId }, data: { seaFreightPerUnit: line.unitFreight } })
      const lots = await tx.inventoryLocation.findMany({ where: { inboundNo: order.inboundNo, productId: line.productId } })
      for (const lot of lots) await tx.inventoryLocation.update({ where: { id: lot.id }, data: { seaFreightPerUnit: line.unitFreight, unitCostRmb: unitCostRmb({ costRmb: lot.costRmb, seaFreightPerUnit: line.unitFreight, domesticFeePerUnit: lot.domesticFeePerUnit }) } })
    }
    await tx.inboundOrder.update({ where: { id: order.id }, data: { remark: patchInboundRemarkSeaFreight(order.remark, next ? { mode: next.mode, total: next.totalAmount } : null) } })
    await writeInboundSeaFreightToCatalog(tx, { inboundNo: order.inboundNo, action: clear ? '入库海运费清除' : '入库海运费补录', lines: allocated.map(line => ({ sku: line.sku, seaFreightPerUnit: line.unitFreight })) })
    await tx.operationLog.create({ data: { operatorId: BigInt(ownerId), module: 'inbound', action: clear ? 'sea_freight_clear' : 'sea_freight_backfill', targetType: 'inbound_order', targetId: order.inboundNo,
      detail: { clientRequestId: input.clientRequestId, requestFingerprint: fingerprint, inboundId: id, mode: next?.mode || null, totalAmount: next?.totalAmount || 0, skuCount: allocated.length } } })
    return { id, inboundNo: order.inboundNo, duplicate: false, committed: true }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 })
}
