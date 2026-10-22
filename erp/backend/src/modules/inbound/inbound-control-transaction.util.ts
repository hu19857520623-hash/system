import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { InventoryMutationService } from '../../common/inventory/inventory-mutation.service'
import type { InboundControlDto } from './dto/inbound-control.dto'
import { assertCountManagement } from './inbound-count-management.util'
import { reductionTarget } from './inbound-reduce.util'
import { inboundReceivingVersion } from './inbound-receiving-version.util'
import { attachInboundWorkflowRevision, INBOUND_WAREHOUSE_ACTIONS } from './inbound-workflow-revision.util'
import { writeInboundActualToCatalog } from '../pricing/catalog-sync.util'

export type InboundControlKind = 'resolve-exception' | 'reopen-count' | 'close-zero' | 'reduce-qc' | 'reduce-carton' | 'reduce-putaway'
const actions: Record<InboundControlKind, string> = { 'resolve-exception': 'resolve_exception', 'reopen-count': 'reopen_count', 'close-zero': 'close_zero_receipt', 'reduce-qc': 'reduce_qc', 'reduce-carton': 'reduce_carton', 'reduce-putaway': 'reduce_putaway' }
export function normalizeInboundControl(id: number, kind: InboundControlKind, body: InboundControlDto) {
  if (!Number.isSafeInteger(id) || id <= 0 || !actions[kind]) throw new BadRequestException('单据或处理类型无效，请重新选择')
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body?.clientRequestId || '')) throw new BadRequestException('请提供有效的处理标识，重新打开单据后重试')
  if (!/^[a-f0-9]{64}$/.test(body.expectedVersion || '')) throw new BadRequestException('请重新读取最新单据后处理')
  if (typeof body.reason !== 'string' || body.reason.trim().length < 2 || body.reason.trim().length > 500) throw new BadRequestException('请填写2至500个字的实际处理原因')
  const request: { id: number; kind: InboundControlKind; expectedVersion: string; reason: string; quantity?: number; expectedCurrent?: number; inboundItemId?: number } = { id, kind, expectedVersion: body.expectedVersion, reason: body.reason.trim() }
  if (kind.startsWith('reduce-')) {
    if (typeof body.quantity !== 'number' || !Number.isSafeInteger(body.quantity) || body.quantity <= 0 || body.quantity > 2147483647) throw new BadRequestException('减少数量必须为正整数且未超出范围')
    if (typeof body.expectedCurrent !== 'number' || !Number.isSafeInteger(body.expectedCurrent) || body.expectedCurrent < 0 || body.expectedCurrent > 2147483647) throw new BadRequestException('请重新读取当前数量后减少')
    request.quantity = body.quantity; request.expectedCurrent = body.expectedCurrent
    if (kind !== 'reduce-carton') {
      if (!Number.isSafeInteger(body.inboundItemId) || !body.inboundItemId || body.inboundItemId <= 0) throw new BadRequestException('请选择本单的确切SKU明细')
      request.inboundItemId = body.inboundItemId
    } else if (body.inboundItemId != null) throw new BadRequestException('减少箱数不接受SKU明细，请重新打开操作')
  } else if (body.quantity != null || body.inboundItemId != null || body.expectedCurrent != null) throw new BadRequestException('当前处理不接受减少数量，请重新打开正确操作')
  return request
}

export async function runInboundControl(prisma: PrismaService, inventory: InventoryMutationService, id: number, kind: InboundControlKind, body: InboundControlDto, operatorId?: number) {
  if (!Number.isSafeInteger(operatorId) || !operatorId || operatorId <= 0) throw new ForbiddenException('请重新登录后处理仓库单据')
  const request = normalizeInboundControl(id, kind, body), fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex')
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(operatorId)} FOR UPDATE`
    const previous = await tx.operationLog.findFirst({ where: { operatorId: BigInt(operatorId), module: 'inbound', action: { in: INBOUND_WAREHOUSE_ACTIONS }, detail: { path: '$.clientRequestId', equals: body.clientRequestId } } })
    if (previous) {
      const detail = previous.detail as any
      if (detail.requestFingerprint !== fingerprint) throw new ConflictException('原处理对应的单据或内容不同，请先核对原操作，不要修改后重试')
      return { ...detail.response, duplicate: true, message: '原处理已完成，本次未重复修改，请按最新单据继续' }
    }
    await tx.$queryRaw`SELECT id FROM inbound_order WHERE id = ${BigInt(id)} FOR UPDATE`
    const order = await tx.inboundOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true, cartons: true, putawayItems: true } })
    if (!order) throw new NotFoundException('入库单不存在，请返回列表重新读取')
    await attachInboundWorkflowRevision(tx, order)
    if (inboundReceivingVersion(order) !== request.expectedVersion) throw new ConflictException('单据、数量或处理进度已变更，请重新读取最新单据再操作')
    if (!order.items.length) throw new BadRequestException('单据没有商品明细，请联系主管核对')
    const statusBefore = order.status
    let before: number | null = null, after: number | null = null, sku: string | null = null, locationCode: string | null = null, boxes: string[] = [], affectedQty = 0
    if (kind === 'reopen-count' || kind === 'close-zero') {
      assertCountManagement(order, kind === 'reopen-count' ? 'reopen' : 'close-zero')
      const data = kind === 'reopen-count'
        ? { status: 'receiving', qcAt: null, qcBy: null, confirmedAt: null, confirmedBy: null, putawayAt: null, putawayBy: null }
        : { status: 'completed', confirmedAt: new Date(), confirmedBy: BigInt(operatorId) }
      await tx.inboundOrder.update({ where: { id: order.id }, data }); order.status = data.status
      if (kind === 'close-zero') await writeInboundActualToCatalog(tx, { inboundNo: order.inboundNo, lines: order.items.map(item => ({ sku: item.sku, actualQty: 0 })) })
    } else if (kind === 'resolve-exception') {
      if (order.status !== 'exception') throw new BadRequestException('仅异常状态的入库单可确认继续作业，请读取最新进度')
      if (order.items.some(item => item.actualQty == null || !Number.isSafeInteger(item.actualQty) || item.actualQty < 0)) throw new BadRequestException('存在尚未完成的实际清点，请先更正清点后处理异常')
      await tx.inboundOrder.update({ where: { id: order.id }, data: { status: 'pending_putaway' } }); order.status = 'pending_putaway'
    } else {
      const allowed = kind === 'reduce-putaway' ? ['pending_putaway'] : ['arrived', 'receiving']
      if (!allowed.includes(order.status)) throw new BadRequestException('当前单据已提交或进入后续环节，请先核对进度并交主管处理')
      if (kind === 'reduce-carton') {
        const cartons = [...order.cartons].filter(box => box.status === 'received').sort((a, b) => Number(b.receivedAt?.getTime() || 0) - Number(a.receivedAt?.getTime() || 0) || (a.id > b.id ? -1 : 1))
        before = Math.max(order.receivedCartonCount || 0, cartons.length); after = reductionTarget(before, request.quantity!, request.expectedCurrent!)
        const undone = cartons.slice(0, Math.max(0, cartons.length - after)); boxes = undone.map(box => box.boxCode)
        for (const box of undone) await tx.inboundCarton.update({ where: { id: box.id }, data: { status: 'pending', receivedAt: null, receivedBy: null } })
        await tx.inboundOrder.update({ where: { id: order.id }, data: { receivedCartonCount: after } }); order.receivedCartonCount = after
      } else {
        const item = order.items.find(item => Number(item.id) === request.inboundItemId)
        if (!item) throw new NotFoundException('SKU明细不属于当前入库单，请重新读取')
        sku = item.sku; before = kind === 'reduce-qc' ? item.actualQty ?? 0 : item.putawayQty ?? 0; after = reductionTarget(before, request.quantity!, request.expectedCurrent!)
        if (kind === 'reduce-qc') {
          if ((item.putawayQty || 0) > after) throw new BadRequestException('不能减少已上架数量，请先处理上架记录')
          await tx.inboundOrderItem.update({ where: { id: item.id }, data: { actualQty: after, diffQty: after - item.expectedQty } }); item.actualQty = after
        } else {
          const last = [...order.putawayItems].filter(row => row.inboundItemId === item.id && row.qty > 0).sort((a, b) => a.id > b.id ? -1 : 1)[0]
          if (!last || request.quantity! > last.qty) throw new BadRequestException(`该SKU最近一笔上架最多可撤回 ${last?.qty || 0} 件，请核对后减少`)
          locationCode = last.locationCode
          await tx.$queryRaw`SELECT id FROM product WHERE id = ${item.productId} FOR UPDATE`
          await inventory.undoPutawayStock(tx, { productId: item.productId, sku: item.sku, warehouseCode: order.warehouseCode, locationId: last.locationId, inboundNo: order.inboundNo, qty: request.quantity!, operatorId, reason: request.reason })
          await tx.inboundPutawayItem.update({ where: { id: last.id }, data: { qty: { decrement: request.quantity! } } })
          await tx.inboundOrderItem.update({ where: { id: item.id }, data: { putawayQty: after } }); item.putawayQty = after
        }
      }
      affectedQty = request.quantity!
    }
    const messages: Record<InboundControlKind, string> = {
      'reopen-count': '已退回收货中，请按实际数量重新清点', 'close-zero': '零收货已结束，本次未增加库存', 'resolve-exception': '异常处理已保存，请继续测量与上架',
      'reduce-carton': `已减少 ${affectedQty} 箱，当前 ${after ?? 0} 箱，请重新确认箱数`, 'reduce-qc': `已减少 ${affectedQty} 件，当前实收 ${after ?? 0} 件，请继续清点`, 'reduce-putaway': `已撤回最近上架 ${affectedQty} 件，当前已上架 ${after ?? 0} 件，请核对实际库位后继续`,
    }
    const response = { id, inboundNo: order.inboundNo, status: order.status, kind, before, after, sku, locationCode, boxes, message: messages[kind], inventoryChanged: kind === 'reduce-putaway' }
    await tx.operationLog.create({ data: { operatorId: BigInt(operatorId), module: 'inbound', action: actions[kind], targetType: 'inbound_order', targetId: order.inboundNo,
      detail: JSON.parse(JSON.stringify({ clientRequestId: body.clientRequestId, requestFingerprint: fingerprint, request, response, reason: request.reason, statusBefore, statusAfter: order.status, quantities: order.items.map(item => ({ sku: item.sku, actualQty: item.actualQty, putawayQty: item.putawayQty })) })) } })
    return { ...response, duplicate: false }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 })
}
