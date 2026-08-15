import {
  addReturnOrder as pushReturn,
  deleteReturnOrder,
  getReturnOrdersSnapshot,
  updateReturnOrder,
  upsertReturnOrder,
} from './entityStore'
import type { FileAttachment } from './mockData'
import { createErpReturn, cancelErpReturn, decideErpReturn, syncErpReturns, type ErpReturnOrder } from '../api/erp'
import { getCustomerCode } from './dataScope'

function formatArrivalFromErp(iso?: string | null, fallback?: string): string | undefined {
  if (iso) {
    const d = new Date(iso)
    if (!Number.isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    return iso.slice(0, 16).replace('T', ' ')
  }
  return fallback
}

export type ReturnLineItem = { sku: string; name: string; qty: number }

export type ReturnOrder = {
  id: string
  customerId?: string
  returnNo: string
  orderNo: string
  referenceNo?: string
  trackingNo?: string
  sellerStoreName?: string
  sellerTaxNo?: string
  returnWarehouse?: string
  expectedArrivalAt?: string
  returnReason: string
  returnDescription?: string
  requestedProcess: string
  requestedProcessLabel?: string
  status: string
  statusLabel?: string
  processResult?: string
  processResultLabel?: string
  processRemark?: string
  receivedAt?: string
  processedAt?: string
  createdAt: string
  lineItems: ReturnLineItem[]
  remark?: string
  attachments?: FileAttachment[]
  inspectionPhotos?: FileAttachment[]
  totalQty?: number
  totalVolumeCbm?: number | null
  estimatedFeeTotal?: number | null
  feeStatus?: string
  inspectionResult?: string
  inspectionResultLabel?: string
  inspectionRemark?: string
  inspectedAt?: string
  customerDecision?: string
  customerDecisionLabel?: string
  customerDecidedAt?: string
  customerProcessChoice?: string
  customerProcessChoiceLabel?: string
  decisionDeadline?: string
}

export const RETURN_PROCESS_OPTIONS = [
  { value: 'pending_inspection', label: '检查拍照' },
  { value: 'restock', label: '直接上架' },
  { value: 'relabel', label: '换标上架' },
  { value: 'other_issue', label: '等问题' },
] as const

export const RETURN_WAREHOUSE_OPTIONS = [
  { value: 'JHB3', label: 'JHB3' },
  { value: 'CPT2', label: 'CPT2' },
  { value: 'DBN', label: 'DBN' },
] as const

export const RETURN_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  pending_arrival: '在途',
  received: '已收货',
  measured: '已测体积',
  fee_calculated: '已算费',
  awaiting_customer: '待您确认',
  accepted_pending: '待仓库作业',
  dispose_pending: '待销毁',
  arrived: '已到货',
  processing: '处理中',
  completed: '已完成',
  cancelled: '已撤回',
}

/** 草稿 / 已撤回 可进入编辑页修改后再次提交 */
export function canEditReturnOrder(order: Pick<ReturnOrder, 'status'>): boolean {
  return order.status === 'draft' || order.status === 'cancelled'
}

export { pushReturn as addReturnOrder, updateReturnOrder, upsertReturnOrder, deleteReturnOrder }

function mapErpAttachments(erp: ErpReturnOrder): FileAttachment[] | undefined {
  const docs = erp.attachments?.length
    ? erp.attachments.map(a => ({
        kind: a.fileType || 'return_doc',
        fileName: a.fileName,
        url: `/api/erp/returns/${encodeURIComponent(erp.returnNo)}/attachment/${a.id}`,
        uploadedAt: a.createdAt ? String(a.createdAt).slice(0, 16).replace('T', ' ') : '',
        erpAttachmentId: a.id,
      }))
    : []
  const photos = erp.inspectionPhotos?.length
    ? erp.inspectionPhotos.map(a => ({
        kind: 'inspection_photo',
        fileName: a.fileName,
        url: `/api/erp/returns/${encodeURIComponent(erp.returnNo)}/attachment/${a.id}`,
        uploadedAt: a.createdAt ? String(a.createdAt).slice(0, 16).replace('T', ' ') : '',
        erpAttachmentId: a.id,
      }))
    : []
  const all = [...docs, ...photos]
  return all.length ? all : undefined
}

function splitAttachments(all?: FileAttachment[]) {
  if (!all?.length) return { attachments: undefined, inspectionPhotos: undefined }
  const inspectionPhotos = all.filter(a => a.kind === 'inspection_photo')
  const attachments = all.filter(a => a.kind !== 'inspection_photo')
  return {
    attachments: attachments.length ? attachments : undefined,
    inspectionPhotos: inspectionPhotos.length ? inspectionPhotos : undefined,
  }
}

export function nextReturnNo(): string {
  const d = new Date()
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const seq = String(getReturnOrdersSnapshot().length + 1).padStart(3, '0')
  return `RT-${date}${seq}`
}

export function applyErpReturnToLocal(erp: ErpReturnOrder, customerId?: string): ReturnOrder {
  const existing = getReturnOrdersSnapshot().find(o => o.returnNo === erp.returnNo)
  const order: ReturnOrder = {
    id: existing?.id || `erp-rt-${erp.id}`,
    customerId: customerId || existing?.customerId,
    returnNo: erp.returnNo,
    orderNo: erp.orderNo,
    referenceNo: erp.referenceNo || existing?.referenceNo,
    trackingNo: erp.trackingNo || existing?.trackingNo,
    sellerStoreName: erp.sellerStoreName || existing?.sellerStoreName,
    sellerTaxNo: erp.sellerTaxNo || existing?.sellerTaxNo,
    returnWarehouse: erp.returnWarehouse || existing?.returnWarehouse,
    expectedArrivalAt: formatArrivalFromErp(erp.expectedArrivalAt, existing?.expectedArrivalAt),
    returnReason: erp.returnReason,
    returnDescription: erp.returnDescription || existing?.returnDescription,
    requestedProcess: erp.requestedProcess,
    requestedProcessLabel: erp.requestedProcessLabel,
    status: erp.status,
    statusLabel: erp.statusLabel,
    processResult: erp.processResult || existing?.processResult,
    processResultLabel: erp.processResultLabel || existing?.processResultLabel,
    processRemark: erp.processRemark || existing?.processRemark,
    receivedAt: erp.receivedAt?.slice(0, 19).replace('T', ' ') || existing?.receivedAt,
    processedAt: erp.processedAt?.slice(0, 19).replace('T', ' ') || existing?.processedAt,
    createdAt: existing?.createdAt || erp.createdAt?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    lineItems: (erp.items || []).map(i => ({
      sku: i.sku,
      name: i.productName || i.sku,
      qty: i.quantity,
    })),
    remark: existing?.remark,
    ...(() => {
      const split = splitAttachments(mapErpAttachments(erp))
      return {
        attachments: split.attachments ?? existing?.attachments,
        inspectionPhotos: split.inspectionPhotos ?? existing?.inspectionPhotos,
      }
    })(),
    totalQty: erp.totalQty,
    totalVolumeCbm: erp.totalVolumeCbm ?? existing?.totalVolumeCbm,
    estimatedFeeTotal: erp.estimatedFeeTotal ?? existing?.estimatedFeeTotal,
    feeStatus: erp.feeStatus ?? existing?.feeStatus,
    inspectionResult: erp.inspectionResult ?? existing?.inspectionResult,
    inspectionResultLabel: erp.inspectionResultLabel ?? existing?.inspectionResultLabel,
    inspectionRemark: erp.inspectionRemark ?? existing?.inspectionRemark,
    inspectedAt: erp.inspectedAt?.slice(0, 19).replace('T', ' ') ?? existing?.inspectedAt,
    customerDecision: erp.customerDecision ?? existing?.customerDecision,
    customerDecisionLabel: erp.customerDecisionLabel ?? existing?.customerDecisionLabel,
    customerDecidedAt: erp.customerDecidedAt?.slice(0, 19).replace('T', ' ') ?? existing?.customerDecidedAt,
    customerProcessChoice: erp.customerProcessChoice ?? existing?.customerProcessChoice,
    customerProcessChoiceLabel: erp.customerProcessChoiceLabel ?? existing?.customerProcessChoiceLabel,
    decisionDeadline: erp.decisionDeadline?.slice(0, 19).replace('T', ' ') ?? existing?.decisionDeadline,
  }
  upsertReturnOrder(order)
  return order
}

export async function submitReturnToErp(
  order: ReturnOrder,
  opts?: { customerCode?: string; customerId?: string },
): Promise<{ ok: true; order: ReturnOrder } | { ok: false; error: string }> {
  const customerCode = opts?.customerCode?.trim() || getCustomerCode(opts?.customerId || order.customerId)
  if (!customerCode || customerCode === '—') {
    return { ok: false, error: '当前角色未绑定客户编码，无法同步 ERP' }
  }
  try {
    const erp = await createErpReturn({
      returnNo: order.returnNo,
      customerCode,
      customerId: opts?.customerId || order.customerId,
      orderNo: order.orderNo,
      referenceNo: order.referenceNo,
      trackingNo: order.trackingNo,
      sellerStoreName: order.sellerStoreName,
      sellerTaxNo: order.sellerTaxNo,
      returnWarehouse: order.returnWarehouse,
      expectedArrivalAt: order.expectedArrivalAt,
      returnReason: order.returnReason,
      returnDescription: order.returnDescription,
      requestedProcess: order.requestedProcess,
      remark: order.remark,
      attachments: (order.attachments || []).map(a => ({
        fileType: a.kind || 'return_doc',
        fileName: a.fileName,
        url: a.url,
      })),
      items: order.lineItems.map(l => ({
        sku: l.sku,
        quantity: l.qty,
        productName: l.name,
      })),
    })
    const merged = applyErpReturnToLocal(erp, order.customerId)
    const finalOrder = order.attachments?.length
      ? { ...merged, attachments: order.attachments }
      : merged
    if (order.attachments?.length) {
      updateReturnOrder(finalOrder.id, { attachments: order.attachments })
    }
    return { ok: true, order: finalOrder }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function refreshReturnsFromErp(customerId: string): Promise<number> {
  const customerCode = getCustomerCode(customerId)
  if (!customerCode || customerCode === '—') return 0
  const data = await syncErpReturns(customerCode)
  for (const item of data.items || []) {
    applyErpReturnToLocal(item, customerId)
  }
  return data.total
}

/** 撤回已提交的退件（仅待到货） */
export async function withdrawReturnOrder(
  order: ReturnOrder,
  opts?: { customerCode?: string; customerId?: string },
): Promise<{ ok: true; order: ReturnOrder } | { ok: false; error: string }> {
  if (order.status !== 'pending_arrival') {
    return { ok: false, error: '仅「待到货」状态的退件可撤回' }
  }
  const customerCode = opts?.customerCode?.trim() || getCustomerCode(opts?.customerId || order.customerId)
  if (!customerCode || customerCode === '—') {
    return { ok: false, error: '未绑定客户编码，无法撤回' }
  }
  try {
    const erp = await cancelErpReturn(order.returnNo, customerCode)
    const merged = applyErpReturnToLocal(erp, order.customerId)
    const finalOrder = order.attachments?.length
      ? { ...merged, attachments: order.attachments }
      : merged
    if (order.attachments?.length) {
      updateReturnOrder(finalOrder.id, { attachments: order.attachments })
    }
    return { ok: true, order: finalOrder }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 删除退件：草稿 / 已撤回 */
export function removeReturnOrder(order: ReturnOrder): { ok: true } | { ok: false; error: string } {
  if (order.status === 'draft' || order.status === 'cancelled') {
    deleteReturnOrder(order.id)
    return { ok: true }
  }
  if (order.status === 'pending_arrival') {
    return { ok: false, error: '请先撤回退件，再删除' }
  }
  return { ok: false, error: '已收货或已完成的退件不可删除' }
}

/** 客户确认留货 / 不留（销毁） */
export async function decideReturnOrder(
  order: ReturnOrder,
  decision: 'keep' | 'discard',
  opts?: { customerCode?: string; customerId?: string; processChoice?: string },
): Promise<{ ok: true; order: ReturnOrder } | { ok: false; error: string }> {
  if (order.status !== 'awaiting_customer') {
    return { ok: false, error: '仅「待您确认」状态的退件可决策' }
  }
  const customerCode = opts?.customerCode?.trim() || getCustomerCode(opts?.customerId || order.customerId)
  if (!customerCode || customerCode === '—') {
    return { ok: false, error: '未绑定客户编码，无法确认' }
  }
  if (decision === 'keep' && !opts?.processChoice) {
    return { ok: false, error: '留货请选择后续处理方式' }
  }
  try {
    const erp = await decideErpReturn(order.returnNo, {
      customerCode,
      decision,
      processChoice: opts?.processChoice,
    })
    const merged = applyErpReturnToLocal(erp, order.customerId)
    return { ok: true, order: merged }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
