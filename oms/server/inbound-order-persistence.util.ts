import { Prisma } from '@prisma/client'
import type { ErpInboundOrder } from './erpClient.js'
import { assertInboundSnapshot, InboundIdentityError } from './inbound-snapshot-guard.util.js'
import { readInboundPlan } from './inbound-plan.util.js'
export { InboundIdentityError } from './inbound-snapshot-guard.util.js'

type InboundDb = Pick<Prisma.TransactionClient, 'inboundOrder' | '$queryRaw' | '$executeRaw'>

/** Same ERP customer lock as ASN creation; account metadata is read again under its own lock. */
async function lockInboundOwner(tx: InboundDb, owner: string | null | undefined) {
  if (!owner) throw new InboundIdentityError(403, '入库单缺少客户归属，请先核对客户')
  const accounts = await tx.$queryRaw<{ code: string }[]>`SELECT code FROM oms_customeraccount WHERE id = ${owner}`
  const code = accounts[0]?.code
  if (!code) throw new InboundIdentityError(404, '客户不存在，请刷新后核对')
  const customers = await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM customer WHERE customer_code = ${code} FOR UPDATE`
  if (!customers.length) throw new InboundIdentityError(404, 'ERP 客户不存在，请联系管理员核对')
  const locked = await tx.$queryRaw<{ code: string }[]>`SELECT code FROM oms_customeraccount WHERE id = ${owner} FOR UPDATE`
  if (locked[0]?.code !== code) throw new InboundIdentityError(409, '客户归属已变化，请刷新后重新操作')
  return code
}

async function assertNotDeleted(tx: InboundDb, id: string, no: string) {
  const deleted = await tx.$queryRaw<{ entity_id: string }[]>`SELECT entity_id FROM oms_snapshot_tombstone WHERE (entity_type = 'inbound' AND entity_id = ${id}) OR (entity_type = 'inbound_no' AND entity_id = ${no})`
  if (deleted.length) throw new InboundIdentityError(409, '入库草稿已删除，请返回记录核对；新预约请使用新单号')
}

export async function deleteInboundDraft(db: Pick<Prisma.TransactionClient, 'inboundOrder'> & { $transaction: any }, id: string, scope: string | null) {
  const identity = await db.inboundOrder.findUnique({ where: { id }, select: { customerId: true } })
  const owner = scope || identity?.customerId
  if (!owner || (scope && identity && identity.customerId !== scope)) throw new InboundIdentityError(404, '当前客户的入库单不存在')
  return db.$transaction(async (tx: InboundDb) => {
    await lockInboundOwner(tx, owner)
    await tx.$queryRaw`SELECT id FROM oms_inboundorder WHERE id = ${id} FOR UPDATE`
    const order = await tx.inboundOrder.findUnique({ where: { id } })
    if (!order) {
      const receipt = await tx.$queryRaw<{ entity_id: string }[]>`SELECT entity_id FROM oms_snapshot_tombstone WHERE entity_type = 'inbound_deleted' AND entity_id = ${JSON.stringify([owner, id])}`
      if (receipt.length) return { ok: true, idempotent: true }
      throw new InboundIdentityError(404, '当前客户的入库单不存在')
    }
    if (order.customerId !== owner) throw new InboundIdentityError(404, '当前客户的入库单不存在')
    if (order.status !== 'draft' || order.receivedQty > 0) throw new InboundIdentityError(409, '仅未提交且未收货的草稿可删除；已提交单据请返回原单核对进度或作废')
    const linked = await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM inbound_order WHERE inbound_no = ${order.inboundNo} FOR UPDATE`
    if (linked.length) throw new InboundIdentityError(409, '该草稿已关联 ERP 入库历史，请保留记录；可返回原单核对或重新下单')
    await tx.$executeRaw`INSERT INTO oms_snapshot_tombstone (entity_type, entity_id) VALUES ('inbound', ${id}), ('inbound_no', ${order.inboundNo}), ('inbound_deleted', ${JSON.stringify([owner, id])})`
    await tx.inboundOrder.delete({ where: { id } })
    return { ok: true, idempotent: false }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
}

export async function saveInboundOrder(
  tx: InboundDb,
  id: string,
  data: Omit<Prisma.InboundOrderUncheckedCreateInput, 'id'>,
  scope: string | null,
  revision?: unknown,
  trusted?: ErpInboundOrder,
) {
  if (scope !== null && !scope) throw new InboundIdentityError(403, '客户身份无效，请重新登录')
  const owner = scope || data.customerId
  if (scope && data.customerId !== scope) throw new InboundIdentityError(403, '该入库单不属于当前客户，无法保存')
  const customerCode = await lockInboundOwner(tx, owner)
  await assertNotDeleted(tx, id, data.inboundNo)
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
  readInboundPlan(data, data.status === 'draft')
  await assertInboundSnapshot(tx, { id, ...data }, customerCode, revision, trusted)
  return tx.inboundOrder.upsert({
    where: { inboundNo: data.inboundNo },
    create: { id, ...data },
    update: data,
    select: { id: true, inboundNo: true },
  })
}
