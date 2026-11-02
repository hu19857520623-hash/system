import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import type { ErpInboundOrder } from './erpClient.js'

export class InboundIdentityError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

type Header = { id: bigint; inboundNo: string; status: string; updatedAt: Date; remark: string | null; warehouseCode: string; trackingNo: string | null; omsCustomerCode: string | null }
type Item = { id: bigint; sku: string; expectedQty: number; actualQty: number | null }
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' && !(value instanceof Date)
    ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value

/** Same wire revision as ERP omsAsnVersion. Real API integration checks parity;
 * OMS runs from its own Docker context and does not load Nest's ERP modules. */
export function inboundSnapshotRevision(order: Header, items: Item[]) {
  const id = Number(order.id)
  if (!Number.isSafeInteger(id) || id <= 0) throw new InboundIdentityError(409, '入库单编号超出可核对范围，请联系管理员')
  const value = { id, inboundNo: order.inboundNo, status: order.status, updatedAt: order.updatedAt, remark: order.remark, warehouseCode: order.warehouseCode, trackingNo: order.trackingNo,
    items: items.map(row => [String(row.id), row.sku, row.expectedQty]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) }
  return createHash('sha256').update(JSON.stringify(canonical(value), (_, x) => typeof x === 'bigint' ? String(x) : x)).digest('hex')
}

const warehouse = (value: string) => ({ jhb1: 'WMS-JHB-01', jhb: 'WMS-JHB-01', cpt1: 'WMS-CPT-01', cpt: 'WMS-CPT-01', dbn: 'WMS-DBN-01' }[value.trim().toLowerCase()] || value.trim().toUpperCase())
const conflict = () => new InboundIdentityError(409, '入库快照已过期或与 ERP 原单不一致，请读取最新原单后继续；本次未覆盖记录')
function lines(value: unknown): { sku: string; qty: number; boxNo: number }[] {
  if (!Array.isArray(value)) throw conflict()
  return value.map((line, index) => {
    if (!line || typeof line !== 'object' || typeof line.sku !== 'string' || !line.sku.trim() || !Number.isSafeInteger(line.qty) || line.qty <= 0) throw conflict()
    const boxNo = line.boxNo ?? index + 1
    if (!Number.isSafeInteger(boxNo) || boxNo <= 0) throw conflict()
    return { sku: line.sku.trim(), qty: line.qty, boxNo }
  })
}
function signature(value: ReturnType<typeof lines>) {
  const grouped = new Map<string, number>()
  for (const row of value) { const key = JSON.stringify([row.boxNo, row.sku]); grouped.set(key, (grouped.get(key) || 0) + row.qty) }
  return JSON.stringify([...grouped].sort(([a], [b]) => a.localeCompare(b)))
}

/** Called inside the owner/customer transaction. A local snapshot is never an
 * alternative way to submit warehouse work or downgrade an already submitted ASN. */
export async function assertInboundSnapshot(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, data: Prisma.InboundOrderUncheckedCreateInput, customerCode: string, revision?: unknown, trusted?: ErpInboundOrder) {
  for (const value of [data.totalQty, data.receivedQty, data.boxCount, data.skuCount]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new InboundIdentityError(400, '入库数量和箱数须为非负整数，请核对后保存')
  }
  const rows = await tx.$queryRaw<Header[]>`SELECT id, inbound_no AS inboundNo, status, updated_at AS updatedAt, remark, warehouse_code AS warehouseCode, tracking_no AS trackingNo, oms_customer_code AS omsCustomerCode FROM inbound_order WHERE inbound_no = ${data.inboundNo} FOR UPDATE`
  const order = rows[0]
  if (!order) {
    if (!['draft', 'voided'].includes(data.status) || data.receivedQty !== 0) throw new InboundIdentityError(409, '预约尚未提交 ERP，不能保存为仓库作业状态；请返回草稿通过提交入口继续')
    return
  }
  if (order.omsCustomerCode !== customerCode) throw new InboundIdentityError(403, '该 ERP 入库单不属于当前客户，不能覆盖记录')
  const items = await tx.$queryRaw<Item[]>`SELECT id, sku, expected_qty AS expectedQty, actual_qty AS actualQty FROM inbound_order_item WHERE inbound_id = ${order.id} ORDER BY id`
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision) || inboundSnapshotRevision(order, items) !== revision) throw conflict()
  // A withdrawn draft may stage new quantities for a future reactivation. It
  // cannot be used while the warehouse order is active or has received goods.
  if (order.status === 'cancelled' && data.status === 'draft' && data.receivedQty === 0 && items.every(row => !row.actualQty)) return
  if (!trusted || trusted.inboundNo !== data.inboundNo || trusted.revision !== revision) throw conflict()
  // Metadata comes from ERP's canonical mapping (including historical remark
  // tags). Fetch it before the OMS transaction, then bind it to the locked row's
  // revision here; no cross-service request is made while holding database locks.
  const text = (value: unknown) => String(value ?? '').trim()
  for (const field of ['referenceNo', 'trackingNo', 'contact', 'contactPhone', 'eta', 'remark', 'inboundType', 'deliveryMethod'] as const) {
    if (text(data[field]) !== text(trusted[field])) throw conflict()
  }
  if (trusted.source && data.source !== trusted.source) throw conflict()
  const expected = items.reduce((sum, row) => sum + row.expectedQty, 0), received = items.reduce((sum, row) => sum + (row.actualQty || 0), 0)
  const status = ['pending_receipt', 'pending_push', 'push_failed', 'pushed'].includes(order.status) ? 'on_the_way'
    : ['arrived', 'receiving'].includes(order.status) ? 'receiving'
      : order.status === 'pending_putaway' ? 'partial'
        : ['completed', 'confirmed'].includes(order.status) ? (received < expected ? 'partial' : 'shelved')
          : order.status === 'cancelled' ? 'voided' : order.status
  if (data.status !== status || data.totalQty !== expected || data.receivedQty !== received || data.skuCount !== items.length || warehouse(data.warehouse) !== warehouse(order.warehouseCode)) throw conflict()
  const cartons = await tx.$queryRaw<{ id: bigint; boxSeq: number }[]>`SELECT id, box_seq AS boxSeq FROM inbound_carton WHERE inbound_id = ${order.id} ORDER BY box_seq`
  const cartonLines = await tx.$queryRaw<{ sku: string; qty: number; boxNo: number }[]>`SELECT i.sku, i.qty, c.box_seq AS boxNo FROM inbound_carton c JOIN inbound_carton_item i ON i.carton_id=c.id WHERE c.inbound_id = ${order.id} ORDER BY c.box_seq, i.id`
  const currentLines = cartonLines.length ? cartonLines : items.map((row, index) => ({ sku: row.sku, qty: row.expectedQty, boxNo: index + 1 }))
  let incoming: unknown
  try { incoming = data.lineItems ? JSON.parse(String(data.lineItems)) : [] } catch { throw conflict() }
  const boxCount = Math.max(cartons.length, new Set(currentLines.map(row => row.boxNo)).size, 1)
  if (data.boxCount !== boxCount || signature(lines(incoming)) !== signature(currentLines)) throw conflict()
}
