import { BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { InventoryMutationService } from '../../common/inventory/inventory-mutation.service'

export type InboundReduction = {
  inboundItemId?: number
  quantity?: number
  expectedCurrent?: number
  reason?: string
  clientRequestId?: string
}

export function reductionTarget(current: number, quantity: number, expectedCurrent: number): number {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new BadRequestException('减少数量必须为正整数')
  if (!Number.isSafeInteger(expectedCurrent) || current !== expectedCurrent) throw new BadRequestException('数量已发生变化，请刷新后核对再减少')
  if (quantity > current) throw new BadRequestException('减少数量不能超过当前数量')
  return current - quantity
}

export async function reduceInboundQuantity(
  prisma: PrismaService,
  inventory: InventoryMutationService,
  id: number,
  mode: 'qc' | 'carton' | 'putaway',
  body: InboundReduction,
  operatorId?: number,
) {
  const qty = Number(body.quantity)
  const expected = Number(body.expectedCurrent)
  const reason = String(body.reason || '').trim().slice(0, 500)
  const requestId = String(body.clientRequestId || '').trim().slice(0, 100)
  if (reason.length < 2 || !requestId) throw new BadRequestException('请填写撤回原因及请求标识')
  const action = `reduce_${mode}`
  return prisma.$transaction(async (tx) => {
    // Same-order retries serialize; the audit record and mutation commit together.
    await tx.$queryRaw`SELECT id FROM inbound_order WHERE id = ${BigInt(id)} FOR UPDATE`
    const order = await tx.inboundOrder.findUnique({ where: { id: BigInt(id) } })
    if (!order) throw new NotFoundException('入库单不存在')
    const duplicate = await tx.operationLog.findFirst({ where: {
      module: 'inbound', action, targetId: order.inboundNo,
      detail: { path: '$.clientRequestId', equals: requestId },
    } })
    if (duplicate) return { message: '该减少请求已处理，请按最新数量核对', duplicate: true }
    const allowed = mode === 'putaway' ? ['pending_putaway'] : ['arrived', 'receiving']
    if (!allowed.includes(order.status)) throw new BadRequestException('当前单据已提交或进入后续环节，请交主管处理')
    let current: number
    let target: number
    let sku: string | null = null
    let locationCode: string | null = null
    let boxes: string[] = []
    if (mode === 'carton') {
      const cartons = await tx.inboundCarton.findMany({ where: { inboundId: order.id, status: 'received' }, orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }] })
      current = Math.max(order.receivedCartonCount ?? 0, cartons.length)
      target = reductionTarget(current, qty, expected)
      const undone = cartons.slice(0, Math.max(0, cartons.length - target))
      boxes = undone.map((c) => c.boxCode)
      for (const carton of undone) {
        const changed = await tx.inboundCarton.updateMany({ where: { id: carton.id, status: 'received' }, data: { status: 'pending', receivedAt: null, receivedBy: null } })
        if (changed.count !== 1) throw new BadRequestException('箱数已变化，请刷新重试')
      }
      const changed = await tx.inboundOrder.updateMany({ where: { id: order.id, status: order.status, receivedCartonCount: order.receivedCartonCount }, data: { receivedCartonCount: target } })
      if (changed.count !== 1) throw new BadRequestException('单据已变化，请刷新重试')
    } else {
      if (!Number.isSafeInteger(Number(body.inboundItemId)) || Number(body.inboundItemId) <= 0) throw new BadRequestException('请选择 SKU')
      const item = await tx.inboundOrderItem.findFirst({ where: { id: BigInt(body.inboundItemId!), inboundId: order.id } })
      if (!item) throw new NotFoundException('SKU 不属于当前入库单')
      sku = item.sku
      current = mode === 'qc' ? item.actualQty ?? 0 : item.putawayQty ?? 0
      target = reductionTarget(current, qty, expected)
      if (mode === 'qc') {
        if ((item.putawayQty ?? 0) > target) throw new BadRequestException('不能减少已上架数量，请先处理上架记录')
        const changed = await tx.inboundOrderItem.updateMany({ where: { id: item.id, actualQty: item.actualQty }, data: { actualQty: target, diffQty: target - item.expectedQty } })
        if (changed.count !== 1) throw new BadRequestException('清点数量已变化，请刷新重试')
      } else {
        const last = await tx.inboundPutawayItem.findFirst({ where: { inboundId: order.id, inboundItemId: item.id, qty: { gt: 0 } }, orderBy: { id: 'desc' } })
        if (!last || qty > last.qty) throw new BadRequestException(`该 SKU 最近一笔上架最多可撤回 ${last?.qty ?? 0} 件，请核对后减少`)
        locationCode = last.locationCode
        await inventory.undoPutawayStock(tx, { productId: item.productId, sku: item.sku, warehouseCode: order.warehouseCode, locationId: last.locationId, inboundNo: order.inboundNo, qty, operatorId, reason })
        const changed = await tx.inboundPutawayItem.updateMany({ where: { id: last.id, qty: last.qty }, data: { qty: { decrement: qty } } })
        if (changed.count !== 1) throw new BadRequestException('上架记录已变化，请刷新重试')
        const changedItem = await tx.inboundOrderItem.updateMany({ where: { id: item.id, putawayQty: item.putawayQty }, data: { putawayQty: target } })
        if (changedItem.count !== 1) throw new BadRequestException('上架数量已变化，请刷新重试')
      }
    }
    await tx.operationLog.create({ data: {
      operatorId: operatorId ? BigInt(operatorId) : undefined, module: 'inbound', action,
      targetType: 'inbound_order', targetId: order.inboundNo,
      detail: { sku, locationCode, boxes, before: current, after: target, quantity: qty, reason, clientRequestId: requestId },
    } })
    return { message: `已减少 ${qty} ${mode === 'carton' ? '箱' : '件'}，当前 ${target}`, before: current, after: target, sku, locationCode, boxes }
  })
}
