import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { InboundIdentityError } from './inbound-snapshot-guard.util.js'

const fields = ['id', 'customerId', 'inboundNo', 'source', 'inboundType', 'deliveryMethod', 'stockSource', 'boxCount', 'skuCount', 'totalQty', 'receivedQty', 'status', 'createdAt', 'eta', 'warehouse', 'referenceNo', 'trackingNo', 'contact', 'contactPhone', 'skuHint', 'remark', 'exceptionCode', 'exceptionReason', 'lineItems', 'attachments']
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
/** A separate OMS revision covers the entire saved plan, including lines/files. */
export function inboundSavedVersion(row: Record<string, any>) {
  return hash(fields.map(field => [field, row[field] ?? null]))
}
type Saved = { id: string; inboundNo: string; customerId: string | null; [key: string]: any }
type Receipt = { request_id: string; actor_id: string; customer_id: string; content_hash: string; status: string; result: string | null }
export type InboundSavePlan = { order: Record<string, any>; expected: string | null }
type Db = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw' | 'inboundOrder'>
const fail = (text: string, status = 409) => new InboundIdentityError(status, text)
function identity(id: unknown, actor: string, customer: string) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw fail('草稿保存请求编号无效，请保留输入并重新核对', 400)
  if (!actor || !customer) throw fail('缺少原保存账号或客户，请返回原账号核对', 403)
  return id.toLowerCase()
}
function plansFor(value: unknown, customer: string): InboundSavePlan[] {
  if (!Array.isArray(value) || !value.length || value.length > 5000) throw fail('请提交 1 至 5000 张入库草稿或快照', 400)
  const ids = new Set<string>(), nos = new Set<string>()
  for (const plan of value) {
    if (!plan || typeof plan !== 'object' || !plan.order || typeof plan.order !== 'object' || Array.isArray(plan.order)
      || typeof plan.order.id !== 'string' || !plan.order.id.trim() || typeof plan.order.inboundNo !== 'string' || !plan.order.inboundNo.trim()
      || (plan.expected !== null && (typeof plan.expected !== 'string' || !/^[a-f0-9]{64}$/.test(plan.expected)))) throw fail('原保存资料或版本无效，请保留输入并从记录重新核对', 400)
    if (plan.order.customerId !== customer) throw fail('原保存资料不属于当前客户，请返回原账号核对', 403)
    if (ids.has(plan.order.id) || nos.has(plan.order.inboundNo)) throw fail('一批保存不能包含重复的入库单，请核对后重试', 400)
    ids.add(plan.order.id); nos.add(plan.order.inboundNo)
  }
  return value
}
async function lockOwner(tx: Db, customer: string) {
  const accounts = await tx.$queryRaw<{ code: string }[]>`SELECT code FROM oms_customeraccount WHERE id=${customer}`
  if (!accounts[0]?.code) throw fail('原保存客户不存在，请返回记录核对', 404)
  const code = accounts[0].code
  const erp = await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM customer WHERE customer_code=${code} FOR UPDATE`
  if (!erp.length) throw fail('ERP 客户不存在，请联系管理员核对', 404)
  const locked = await tx.$queryRaw<{ code: string }[]>`SELECT code FROM oms_customeraccount WHERE id=${customer} FOR UPDATE`
  if (locked[0]?.code !== code) throw fail('客户归属已变化，请返回原账号核对')
}
async function previous(tx: Db, id: string, actor: string, customer: string) {
  const row = (await tx.$queryRaw<Receipt[]>`SELECT request_id,actor_id,customer_id,content_hash,status,result FROM oms_inbound_save WHERE request_id=${id}`)[0]
  if (row && (row.actor_id !== actor || row.customer_id !== customer)) throw fail('该保存请求不属于当前账号和客户', 403)
  return row
}
function reply(row: Receipt) {
  if (!['confirmed', 'cancelled'].includes(row.status)) throw fail('原保存回执无法识别，请保留原请求并联系管理员')
  let identities: unknown
  try { identities = row.result ? JSON.parse(row.result) : [] } catch { throw fail('原保存回执无法读取，请保留原请求并联系管理员') }
  if (!Array.isArray(identities)) throw fail('原保存回执无法读取，请保留原请求并联系管理员')
  return { requestId: row.request_id, status: row.status as 'confirmed' | 'cancelled', identities }
}
export async function runInboundSave(db: { $transaction: any }, request: unknown, actor: string, customer: string, input: unknown,
  save: (tx: Prisma.TransactionClient, order: Record<string, any>) => Promise<{ id: string; inboundNo: string }>,
  reconcileCanonical?: (tx: Prisma.TransactionClient, incoming: Record<string, any>, current: Saved) => Promise<boolean>,
) {
  const id = identity(request, actor, customer), plans = plansFor(input, customer), fingerprint = hash([customer, plans])
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    await lockOwner(tx, customer)
    const old = await previous(tx, id, actor, customer)
    if (old) {
      if (old.content_hash !== fingerprint) throw fail('原保存请求内容不能更改，请先核对或取消原请求')
      return { ...reply(old), replay: true }
    }
    // Check every precondition before any save; owner lock serializes all clients.
    for (const plan of plans) {
      const row = await tx.inboundOrder.findUnique({ where: { inboundNo: plan.order.inboundNo } }) as Saved | null
      if (row && row.customerId !== customer) throw fail('该入库单不属于当前客户', 403)
      if (row ? plan.expected !== inboundSavedVersion(row) : plan.expected !== null) {
        // An ERP webhook can precede its client's canonical acknowledgement.
        // Only the caller's locked ERP canonical validator may allow this case;
        // a staged OMS draft must always keep its own precondition.
        if (!row || row.status === 'draft' || !reconcileCanonical || !(await reconcileCanonical(tx, plan.order, row))) throw fail(`入库单 ${plan.order.inboundNo} 的已保存资料发生变化，本次未覆盖；请保留输入并读取最新记录后重新打开`)
      }
    }
    const identities = []
    for (const plan of plans) {
      const result = await save(tx, plan.order)
      const saved = await tx.inboundOrder.findUniqueOrThrow({ where: { inboundNo: result.inboundNo } })
      identities.push({ ...result, omsRevision: inboundSavedVersion(saved) })
    }
    await tx.$executeRaw`INSERT INTO oms_inbound_save (request_id,actor_id,customer_id,content_hash,status,result) VALUES (${id},${actor},${customer},${fingerprint},'confirmed',${JSON.stringify(identities)})`
    return { requestId: id, status: 'confirmed' as const, identities, replay: false }
  }, { isolationLevel: 'ReadCommitted', timeout: 30000 })
}

/** Cancellation is a durable fence against a request still in flight, not an undo. */
export async function resolveInboundSave(db: { $transaction: any }, request: unknown, actor: string, customer: string, input: unknown, cancel: boolean) {
  const id = identity(request, actor, customer), plans = plansFor(input, customer), fingerprint = hash([customer, plans])
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    await lockOwner(tx, customer)
    const old = await previous(tx, id, actor, customer)
    if (old) {
      if (old.content_hash !== fingerprint) throw fail('原保存请求内容不能更改，请核对当时保存的资料')
      return reply(old)
    }
    if (!cancel) return { requestId: id, status: 'unknown' as const, identities: [] }
    await tx.$executeRaw`INSERT INTO oms_inbound_save (request_id,actor_id,customer_id,content_hash,status,result) VALUES (${id},${actor},${customer},${fingerprint},'cancelled','[]')`
    return { requestId: id, status: 'cancelled' as const, identities: [] }
  }, { isolationLevel: 'ReadCommitted', timeout: 30000 })
}
