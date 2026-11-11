import type { Prisma } from '@prisma/client'
import type { ErpInboundOrder } from './erpClient.js'
import { InboundIdentityError, inboundSnapshotRevision, assertInboundSnapshot } from './inbound-snapshot-guard.util.js'
import { readInboundPlan } from './inbound-plan.util.js'

const failure = (message: string, status = 409) => new InboundIdentityError(status, message)
const warehouse = (code: string) => ({ 'WMS-JHB-01': 'jhb1', 'WMS-CPT-01': 'cpt1', 'WMS-DBN-01': 'dbn' }[code] || code || 'jhb1')
/** Treat a webhook as a wake-up signal. Its old payload never becomes the state
 * authority; preflight current ERP data, then pin it to the locked ERP revision. */
export async function receiveInboundStatus(db: { $transaction: any }, code: string, no: string, deleted: boolean,
  fetchCurrent: () => Promise<ErpInboundOrder>,
) {
  if (!code.trim() || code === '*' || !no.trim()) throw failure('入库通知缺少有效客户或单号', 400)
  const canonical = deleted ? null : await fetchCurrent()
  if (canonical && (canonical.inboundNo !== no || canonical.omsCustomerCode !== code)) throw failure('入库通知与 ERP 当前客户或单号不一致', 403)
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const customer = await tx.customerAccount.findFirst({ where: { code }, select: { id: true } })
    if (!customer) throw failure('入库通知客户不存在，请先同步客户档案', 404)
    const erpCustomer = await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM customer WHERE customer_code=${code} FOR UPDATE`
    if (!erpCustomer.length) throw failure('入库通知的 ERP 客户不存在', 404)
    const accounts = await tx.$queryRaw<{ id: string; code: string }[]>`SELECT id,code FROM oms_customeraccount WHERE id=${customer.id} FOR UPDATE`
    if (accounts[0]?.code !== code) throw failure('通知客户归属已变化，请重新同步')
    const headers = await tx.$queryRaw<{ id: bigint; inboundNo: string; status: string; updatedAt: Date; remark: string | null; warehouseCode: string; trackingNo: string | null; omsCustomerCode: string | null }[]>`SELECT id,inbound_no AS inboundNo,status,updated_at AS updatedAt,remark,warehouse_code AS warehouseCode,tracking_no AS trackingNo,oms_customer_code AS omsCustomerCode FROM inbound_order WHERE inbound_no=${no} FOR UPDATE`
    const header = headers[0]
    const existing = await tx.inboundOrder.findUnique({ where: { inboundNo: no } })
    if (existing && existing.customerId !== customer.id) throw failure('通知不能覆盖其他客户的入库记录', 403)
    if (header && header.omsCustomerCode !== code) throw failure('ERP 入库单不属于通知客户', 403)
    // An old deletion signal must not delete a recreated ASN or OMS history.
    if (deleted) return { skipped: header ? 'ERP 原单仍存在，忽略删除通知' : 'ERP 原单已不存在，保留 OMS 历史记录' }
    if (!header || !canonical) throw failure('ERP 当前入库单不存在，本次通知未覆盖记录')
    const items = await tx.$queryRaw<{ id: bigint; sku: string; expectedQty: number; actualQty: number | null }[]>`SELECT id,sku,expected_qty AS expectedQty,actual_qty AS actualQty FROM inbound_order_item WHERE inbound_id=${header.id} ORDER BY id`
    if (!canonical.revision || inboundSnapshotRevision(header, items) !== canonical.revision) throw failure('ERP 入库状态在同步期间发生变化，请重试通知；本次未覆盖记录')
    if (canonical.inboundType === '货盘入库' || canonical.stockSource === 'catalog') return { skipped: '货盘入库仅由 ERP 管理，保留现有 OMS 历史' }
    // A cancellation describes the last submission, not a subsequently saved plan.
    if (header.status === 'cancelled' && canonical.totalReceivedQty === 0 && items.every(row => !row.actualQty) && existing?.status === 'draft') return { skipped: '已取消预报的客户草稿已保留' }
    const lineItems = canonical.cartons?.some(box => box.items?.length)
      ? canonical.cartons.flatMap(box => (box.items || []).map(item => ({ sku: item.sku, name: canonical.items.find(row => row.sku === item.sku)?.productName || item.sku, qty: item.qty, boxNo: box.boxSeq, packType: '自带包装', stockType: '以仓库为准' })))
      : canonical.items.map((item, index) => ({ sku: item.sku, name: item.productName || item.sku, qty: item.expectedQty, boxNo: index + 1, packType: '自带包装', stockType: '以仓库为准' }))
    const status = ['cancelled', 'voided'].includes(canonical.omsStatus) ? 'voided' : canonical.omsStatus
    const data = { customerId: customer.id, inboundNo: no, source: canonical.source || 'ERP回传', inboundType: ['自发头程', '中转入库', '退货入库'].includes(canonical.inboundType || '') ? canonical.inboundType! : '自发头程',
      deliveryMethod: canonical.deliveryMethod || 'self', stockSource: 'owned', status, totalQty: canonical.totalExpectedQty, receivedQty: canonical.totalReceivedQty,
      skuCount: canonical.items.length, boxCount: Math.max(canonical.cartons?.length || 0, new Set(lineItems.map(line => line.boxNo)).size, 1),
      createdAt: existing?.createdAt || canonical.createdAt.slice(0, 10), warehouse: warehouse(canonical.warehouseCode), trackingNo: canonical.trackingNo ?? null,
      referenceNo: canonical.referenceNo ?? null, eta: canonical.eta ?? null, contact: canonical.contact ?? null, contactPhone: canonical.contactPhone ?? null, remark: canonical.remark ?? null,
      lineItems: JSON.stringify(lineItems), attachments: existing?.attachments ?? null,
    }
    readInboundPlan(data, false)
    await assertInboundSnapshot(tx, { id: existing?.id || `erp-ib-${canonical.id}`, ...data }, code, canonical.revision, { ...canonical, inboundType: data.inboundType, deliveryMethod: data.deliveryMethod })
    await tx.inboundOrder.upsert({ where: { inboundNo: no }, create: { id: `erp-ib-${canonical.id}`, ...data }, update: data })
    return { synced: true, status, totalQty: data.totalQty }
  }, { isolationLevel: 'ReadCommitted', timeout: 30000 })
}
