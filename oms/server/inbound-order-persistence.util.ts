import type { Prisma } from '@prisma/client'

export class InboundIdentityError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function saveInboundOrder(
  tx: Pick<Prisma.TransactionClient, 'inboundOrder'>,
  id: string,
  data: Omit<Prisma.InboundOrderUncheckedCreateInput, 'id'>,
  scope: string | null,
) {
  if (scope !== null && !scope) throw new InboundIdentityError(403, '客户身份无效，请重新登录')
  const [byId, byNo] = await Promise.all([
    tx.inboundOrder.findUnique({ where: { id }, select: { id: true, inboundNo: true, customerId: true } }),
    tx.inboundOrder.findUnique({ where: { inboundNo: data.inboundNo }, select: { id: true, inboundNo: true, customerId: true } }),
  ])
  for (const existing of [byId, byNo]) {
    if (existing && ((scope && existing.customerId !== scope) || existing.customerId !== data.customerId)) {
      throw new InboundIdentityError(403, '该入库单不属于当前客户，无法保存')
    }
  }
  if (byId && byId.inboundNo !== data.inboundNo) {
    throw new InboundIdentityError(409, '入库单标识与单号不一致，请刷新后重试')
  }
  return tx.inboundOrder.upsert({
    where: { inboundNo: data.inboundNo },
    create: { id, ...data },
    update: data,
    select: { id: true, inboundNo: true },
  })
}
