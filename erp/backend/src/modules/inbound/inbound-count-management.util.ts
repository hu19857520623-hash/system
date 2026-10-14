import { BadRequestException, NotFoundException } from '@nestjs/common'

export function assertCountManagement(order: any, mode: 'reopen' | 'close-zero') {
  if (!order) throw new NotFoundException('入库单不存在')
  if (!order.items?.length) throw new BadRequestException('入库单没有清点明细')
  if (order.items.some((item: any) => Number(item.putawayQty ?? 0) > 0) || order.putawayItems?.some((item: any) => Number(item.qty) > 0)) {
    throw new BadRequestException('单据已有上架记录，请先处理库存，不能直接更改清点或零收货结束')
  }
  const zero = order.items.every((item: any) => item.actualQty !== null && item.actualQty !== undefined && Number(item.actualQty) === 0)
  if (mode === 'close-zero') {
    if (!['pending_putaway', 'exception'].includes(order.status) || !zero) {
      throw new BadRequestException('仅全部明细已明确清点为 0 的单据可以零收货结束')
    }
  } else if (!['receiving', 'pending_putaway', 'exception'].includes(order.status) && !(order.status === 'completed' && zero)) {
    throw new BadRequestException('当前单据不可退回更正清点')
  }
}

export async function manageInboundCount(prisma: any, id: number, mode: 'reopen' | 'close-zero', reason: string, operatorId?: number) {
  reason = String(reason || '').trim().slice(0, 500)
  if (reason.length < 2) throw new BadRequestException('请填写不少于 2 个字的处理原因')
  return prisma.$transaction(async (tx: any) => {
    await tx.$queryRaw`SELECT id FROM inbound_order WHERE id = ${BigInt(id)} FOR UPDATE`
    const order = await tx.inboundOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true, putawayItems: true } })
    assertCountManagement(order, mode)
    const updated = await tx.inboundOrder.update({
      where: { id: BigInt(id) },
      data: mode === 'reopen'
        ? { status: 'receiving', qcAt: null, qcBy: null, confirmedAt: null }
        : { status: 'completed', confirmedAt: new Date() },
    })
    await tx.operationLog.create({ data: {
      operatorId: operatorId ? BigInt(operatorId) : undefined,
      module: 'inbound', action: mode === 'reopen' ? 'reopen_count' : 'close_zero_receipt',
      targetType: 'inbound_order', targetId: order.inboundNo,
      detail: { reason, statusBefore: order.status, statusAfter: updated.status, quantities: order.items.map((i: any) => ({ sku: i.sku, actualQty: i.actualQty })) },
    } })
    return { id: Number(updated.id), inboundNo: updated.inboundNo, status: updated.status }
  })
}
