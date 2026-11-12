import { authSessionScope, getStoredAuthSession } from '../api/client'
import { can } from '../auth/permissions'
import { inboundPendingKey, readInboundPending, saveInboundPending, clearInboundPending, markInboundContentChanged, withInboundOperationLock, type InboundPending, type InboundOperationKind } from './inboundPending'
import type { DeliveryMethod, InboundOrder, InboundStatus, InboundType } from './mockData'
import { isErpPalletInbound, sanitizeCustomerInboundType } from './mockData'
import {
  addInboundOrder as pushInbound,
  cacheInboundOrder,
  getInboundOrdersSnapshot,
  updateInboundOrder,
  upsertInboundOrder,
  upsertInboundOrderOrThrow,
} from './entityStore'
import { createErpInbound, updateErpInbound, cancelErpInbound, reactivateErpInbound, fetchErpInbound, resolveErpInboundOriginal, syncErpInbounds, type ErpInboundOrder } from '../api/erp'
import { getCustomerCode } from './dataScope'
import { findProductByCode } from './platformBindingUtils'
import { buildOmsAsnItem } from './omsAsnItem'
import { buildInboundNo, inboundNoPrefix, nextSeqFromNos } from './wmsDocNo'
import { userFacingError } from '../utils/userFacingError'

export type InboundMutationResult = { ok: true; order: InboundOrder; warning?: string; persistencePending?: boolean }
  | { ok: false; error: string; uncertain?: boolean }

export function inboundContentMismatch(message: string) {
  return ['不要修改后重试', '内容不同', '已用于其他内容', '内容已变化', '与原单不同'].some(part => message.includes(part))
}

export function inboundMutationFailure(error: unknown): Extract<InboundMutationResult, { ok: false }> {
  const status = error && typeof error === 'object' ? Number((error as { status?: number }).status) : NaN
  const uncertain = !Number.isFinite(status) || status < 100 || status >= 500 || status === 408
  const message = userFacingError(error)
  return { ok: false, uncertain, error: uncertain
    ? `本次操作结果暂无法确认，请返回入库记录并刷新核对，请勿重复提交。${message}` : message }
}

async function finishErpInboundMutation(order: InboundOrder, completed: string, assertSession: () => void): Promise<InboundMutationResult> {
  assertSession()
  try {
    await upsertInboundOrderOrThrow(order, assertSession)
    const saved = getInboundOrdersSnapshot().find(row => row.inboundNo === order.inboundNo)
    return { ok: true, order: saved || order }
  } catch (error) {
    assertSession()
    // ERP 已确认成功，不能因 OMS 回写失败而把作业退回未提交状态。
    cacheInboundOrder(order)
    return { ok: true, order, persistencePending: true,
      warning: `${completed}，但 OMS 回写失败。原请求已保留，可使用“重试原请求”继续核对，请勿新建重复单据。${userFacingError(error)}` }
  }
}

export { pushInbound as addInboundOrder, updateInboundOrder, upsertInboundOrder }

export function canEditInboundOrder(status: InboundStatus) {
  return status === 'draft' || status === 'on_the_way'
}

export function canVoidInboundOrder(status: InboundStatus) {
  return status === 'draft' || status === 'on_the_way'
}

export function canReorderInboundOrder(status: InboundStatus) {
  return status === 'voided'
}

export function nextInboundNo(customerCode?: string): string {
  const prefix = inboundNoPrefix(customerCode)
  const seq = nextSeqFromNos(getInboundOrdersSnapshot().map(o => o.inboundNo), prefix)
  return buildInboundNo(customerCode, new Date(), seq)
}

function mapErpInboundStatus(omsStatus: string): InboundStatus {
  if (omsStatus === 'cancelled') return 'voided'
  const allowed: InboundStatus[] = ['draft', 'receiving', 'partial', 'completed', 'exception', 'on_the_way', 'shelved', 'voided']
  return (allowed.includes(omsStatus as InboundStatus) ? omsStatus : 'on_the_way') as InboundStatus
}

function lineItemsFromErpCartons(erp: ErpInboundOrder) {
  if (!erp.cartons?.length) return []
  return erp.cartons.flatMap((carton) => {
    const boxNo = Number(carton.boxSeq) > 0 ? Number(carton.boxSeq) : 1
    return (carton.items || []).map((item) => {
      const matched = erp.items.find((line) => line.sku === item.sku)
      return {
        sku: item.sku,
        name: matched?.productName || item.sku,
        qty: item.qty,
        boxNo,
        packType: '自带包装',
        stockType: '以仓库为准',
      }
    })
  })
}

export function buildInboundOrderFromErp(erp: ErpInboundOrder, customerId?: string): InboundOrder {
  const existing = getInboundOrdersSnapshot().find(o => o.inboundNo === erp.inboundNo)
  const cartonLines = lineItemsFromErpCartons(erp)
  const lineItems = cartonLines.length
    ? cartonLines
    : erp.items.map((i, index) => ({
          sku: i.sku,
          name: i.productName || i.sku,
          qty: i.expectedQty,
          boxNo: index + 1,
          packType: '自带包装',
          stockType: '以仓库为准',
        }))
  const boxCount = Math.max(
    erp.cartons?.length || 0,
    new Set(lineItems.map(line => Math.max(1, Number(line.boxNo) || 1))).size,
    1,
  )
  const order: InboundOrder = {
    id: existing?.id || `erp-ib-${erp.id}`,
    customerId: customerId || existing?.customerId,
    inboundNo: erp.inboundNo,
    erpRevision: erp.revision,
    omsRevision: existing?.omsRevision,
    source: erp.source || existing?.source || '客户自发',
    inboundType: sanitizeCustomerInboundType((erp.inboundType as InboundType | null) || existing?.inboundType),
    deliveryMethod: (erp.deliveryMethod as DeliveryMethod | null) || existing?.deliveryMethod || 'self',
    stockSource: 'owned',
    boxCount,
    skuCount: erp.items.length || new Set(lineItems.map(line => line.sku)).size,
    totalQty: erp.totalExpectedQty,
    receivedQty: erp.totalReceivedQty,
    status: mapErpInboundStatus(erp.omsStatus),
    createdAt: existing?.createdAt || new Date().toISOString().slice(0, 10),
    eta: erp.eta || undefined,
    warehouse: erp.warehouseCode || existing?.warehouse || 'jhb1',
    referenceNo: erp.referenceNo || undefined,
    trackingNo: erp.trackingNo || undefined,
    contact: erp.contact || undefined,
    contactPhone: erp.contactPhone || undefined,
    remark: erp.remark || undefined,
    lineItems,
    attachments: existing?.attachments,
  }
  return order
}

export function applyErpInboundToLocal(erp: ErpInboundOrder, customerId?: string): InboundOrder {
  const order = buildInboundOrderFromErp(erp, customerId)
  upsertInboundOrder(order)
  return order
}

function erpAsnPayload(order: InboundOrder, customerCode: string) {
  return {
    inboundNo: order.inboundNo,
    customerCode,
    customerId: order.customerId,
    warehouseCode: 'WMS-JHB-01',
    trackingNo: order.trackingNo,
    remark: order.remark,
    source: order.source || '客户自发',
    inboundType: sanitizeCustomerInboundType(order.inboundType),
    deliveryMethod: order.deliveryMethod,
    stockSource: 'owned',
    referenceNo: order.referenceNo,
    eta: order.eta,
    contact: order.contact,
    contactPhone: order.contactPhone,
    items: (order.lineItems || []).map(line =>
      buildOmsAsnItem(line, findProductByCode(line.sku, order.customerId))),
    attachments: (order.attachments || []).map(a => ({
      fileType: a.kind || 'other',
      fileName: a.fileName,
      url: a.url,
    })),
  }
}

function mergeLocalInboundAfterErp(erp: ErpInboundOrder, local: InboundOrder): InboundOrder {
  const merged = buildInboundOrderFromErp(erp, local.customerId)
  return {
    ...merged,
    id: local.id || merged.id,
    omsRevision: local.omsRevision,
    warehouse: local.warehouse || merged.warehouse,
    lineItems: merged.lineItems,
    attachments: local.attachments ?? merged.attachments,
    remark: erp.remark || undefined,
    source: erp.source || merged.source,
  }
}

const knownFailure = (message: string, status = 409) => Object.assign(new Error(message), { status })
export function captureInboundWriteAccess() {
  const session = getStoredAuthSession(), scope = authSessionScope(session)
  if (!session || !can(session.user.role, 'inbound:write', session.user.permissions)) throw knownFailure('当前账号只有入库查看权限，不能保存、提交或重试写入', 403)
  return () => { if (authSessionScope() !== scope) throw knownFailure('登录或权限已变化，请重新打开原入库单后操作', 403) }
}
function pendingContext(order: InboundOrder, write = false) {
  const session = getStoredAuthSession(), customerCode = getCustomerCode(order.customerId)
  if (!customerCode || customerCode === '—') throw knownFailure('当前角色未绑定客户编码，无法同步 ERP', 403)
  if (!session?.user.id) throw knownFailure('登录已失效，请重新登录后核对原入库操作', 401)
  if (session.user.role !== 'sys_admin' && session.user.customerId !== order.customerId) throw knownFailure('本入库单不属于当前登录客户，请返回原账号核对', 403)
  const scope = authSessionScope(session)
  const assertWrite = write ? captureInboundWriteAccess() : () => {}
  return { key: inboundPendingKey(session.user.id, customerCode, order.inboundNo), customerCode,
    assertSession: () => { assertWrite(); if (authSessionScope() !== scope) throw knownFailure('登录或权限已变化，原操作已保留，请回到原账号核对结果', 401) } }
}

function pendingChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('oms-inbound-original-change'))
}

export function pendingInboundOperation(order: InboundOrder): { record: InboundPending | null; error?: string } {
  if (!order.customerId || getCustomerCode(order.customerId) === '—' || !getStoredAuthSession()) return { record: null }
  try {
    const context = pendingContext(order), record = readInboundPending(localStorage, context.key)
    if (record && (record.localOrder.customerId !== order.customerId || record.inboundNo !== order.inboundNo || record.customerCode !== context.customerCode)) throw knownFailure('原入库操作与当前客户或单据不符，请保留记录并返回原账号核对')
    return { record }
  }
  catch (error) { return { record: null, error: userFacingError(error) } }
}

async function sendOriginal(record: InboundPending) {
  const body = record.body as Parameters<typeof createErpInbound>[0]
  if (record.kind === 'create') return createErpInbound(body)
  if (record.kind === 'update') return updateErpInbound(record.inboundNo, body)
  if (record.kind === 'reactivate') return reactivateErpInbound(record.inboundNo, body)
  return cancelErpInbound(record.inboundNo, body)
}

async function finishOriginal(record: InboundPending, erp: ErpInboundOrder, assertSession: () => void) {
  let order = { ...mergeLocalInboundAfterErp(erp, record.localOrder), omsAcknowledgementKind: record.kind }
  // An old receipt may now refer to an order already processed by another action.
  if (record.kind === 'withdraw' && (erp.status === 'cancelled' || ['cancelled', 'voided'].includes(erp.omsStatus))) order = { ...order, status: 'draft' }
  if (record.kind === 'void' && (erp.status === 'cancelled' || ['cancelled', 'voided'].includes(erp.omsStatus))) order = { ...order, status: 'voided' }
  const result = await finishErpInboundMutation(order, `入库单 ${order.inboundNo} 的原操作已由 ERP 确认`, assertSession)
  const expected = record.kind === 'withdraw' ? 'draft' : record.kind === 'void' ? 'voided' : 'on_the_way'
  if (result.ok && order.status !== expected) {
    result.warning = [result.warning, '原操作结果已确认，单据已进入其他进度；请返回入库记录按最新状态继续，本次没有重新执行旧操作。'].filter(Boolean).join(' ')
  }
  if (result.ok && erp.syncPending) result.warning = [result.warning, 'ERP 原操作已完成，OMS 状态通知仍待同步；可从原操作入口再次核对。'].filter(Boolean).join(' ')
  return result
}

async function runOriginal(order: InboundOrder, kind: InboundOperationKind, retry = false): Promise<InboundMutationResult> {
  try {
    const context = pendingContext(order, true)
    return await withInboundOperationLock(context.key, async () => {
      context.assertSession()
      let record = readInboundPending(localStorage, context.key)
      if (retry) {
        if (!record) throw knownFailure('没有待处理的原操作，请读取最新入库单后继续')
        if (record.contentChanged) throw knownFailure('原入库内容不同。请先核对入库记录，结束本次后再重新填写，不要重试原请求。')
      } else {
        if (record) throw knownFailure('本单有待核对的原操作，请先使用原请求重试或读取原单')
        if (kind !== 'create' && !/^[a-f0-9]{64}$/.test(order.erpRevision || '')) throw knownFailure('原单缺少最新版本，请刷新入库记录并重新打开原单后操作')
        const control = { clientRequestId: crypto.randomUUID(), ...(kind === 'create' ? {} : { expectedVersion: order.erpRevision }) }
        const body = kind === 'withdraw' || kind === 'void'
          ? { customerCode: context.customerCode, customerId: order.customerId, ...control }
          : { ...erpAsnPayload(order, context.customerCode), ...control }
        record = saveInboundPending(localStorage, context.key, { version: 1, kind, customerCode: context.customerCode, inboundNo: order.inboundNo, body, localOrder: JSON.parse(JSON.stringify(order)), createdAt: new Date().toISOString() })
        pendingChanged()
      }
      if (record.customerCode !== context.customerCode || record.inboundNo !== order.inboundNo || record.localOrder.customerId !== order.customerId) throw knownFailure('原请求与当前客户或单据不符，请返回原账号核对')
      let erp: ErpInboundOrder
      try { erp = await sendOriginal(record) }
      catch (error) {
        context.assertSession()
        const status = Number((error as { status?: number })?.status)
        const text = `${error instanceof Error ? error.message : ''} ${userFacingError(error)}`
        if (inboundContentMismatch(text)) {
          markInboundContentChanged(localStorage, context.key, record)
          pendingChanged()
          throw knownFailure(`${userFacingError(error)}。请先核对入库记录，结束本次后再重新填写，不要重试原请求。`)
        }
        // Only a definite first-attempt rejection proves this original did not commit.
        if (!retry && status >= 400 && status < 500 && status !== 408) { clearInboundPending(localStorage, context.key, record); pendingChanged() }
        throw error
      }
      context.assertSession()
      const result = await finishOriginal(record, erp, context.assertSession)
      context.assertSession()
      if (result.ok && !result.persistencePending && !erp.syncPending) { clearInboundPending(localStorage, context.key, record); pendingChanged() }
      return result
    })
  } catch (error) { return inboundMutationFailure(error) }
}

export async function retryInboundOriginal(order: InboundOrder) { return runOriginal(order, 'update', true) }

export async function endChangedInboundOriginal(order: InboundOrder): Promise<InboundMutationResult> {
  try {
    const context = pendingContext(order, true)
    return await withInboundOperationLock(context.key, async () => {
      context.assertSession()
      const record = readInboundPending(localStorage, context.key)
      if (!record?.contentChanged) throw knownFailure('原请求仍待核对，请重试或取消，不要直接结束')
      clearInboundPending(localStorage, context.key, record)
      pendingChanged()
      return { ok: true as const, order, warning: '已结束这次未能按本机内容入账的入库操作。请先核对入库记录；若没有入账，可以重新填写。' }
    })
  } catch (error) { return inboundMutationFailure(error) }
}

/** Retire a saved original only after a matching server receipt. A failed or
 * lost cancellation response keeps the exact record, so a later lookup/retry
 * can acknowledge it without sending the original business operation again. */
export async function resolveInboundOriginal(order: InboundOrder, cancel = false): Promise<InboundMutationResult> {
  try {
    const context = pendingContext(order, cancel)
    return await withInboundOperationLock(context.key, async () => {
      context.assertSession()
      const record = readInboundPending(localStorage, context.key)
      if (!record) throw knownFailure('没有待核对的原请求，请读取最新入库单后继续')
      if (record.customerCode !== context.customerCode || record.inboundNo !== order.inboundNo || record.localOrder.customerId !== order.customerId) throw knownFailure('原请求与当前客户或单据不符，请保留原记录并返回原账号核对')
      const reply = await resolveErpInboundOriginal(record.inboundNo, cancel ? 'cancel' : 'check', {
        customerCode: record.customerCode,
        kind: record.kind === 'withdraw' || record.kind === 'void' ? 'cancel' : record.kind,
        original: record.body,
      })
      context.assertSession()
      if (!['completed', 'cancelled', 'unresolved'].includes(reply.outcome) || (reply.order && reply.order.inboundNo !== record.inboundNo)) throw knownFailure('原请求核对结果无法识别，请保留原记录并再次核对', 502)
      if (reply.outcome === 'completed' && !reply.order) throw knownFailure('原操作已有执行回执，但原单暂无法读取；请保留记录并联系管理员核对', 409)
      const current = reply.order ? mergeLocalInboundAfterErp(reply.order, order) : order
      const session = getStoredAuthSession()
      const canWrite = Boolean(session && can(session.user.role, 'inbound:write', session.user.permissions))
      if (reply.outcome === 'unresolved' || !canWrite) {
        if (reply.order) cacheInboundOrder(current)
        return { ok: true as const, order: current, warning: `${reply.message}；原请求记录仍保留。` }
      }
      // A new permission check also protects the subsequent OMS canonical write.
      const assertWrite = captureInboundWriteAccess()
      const assertCurrent = () => { context.assertSession(); assertWrite() }
      const result = reply.outcome === 'completed'
        ? await finishOriginal(record, reply.order!, assertCurrent)
        : reply.order ? await finishErpInboundMutation(current, reply.message, assertCurrent)
          : record.kind === 'create' ? { ok: true as const, order: current }
            : { ok: false as const, error: '已阻止原请求继续执行，但原单暂无法读取；请保留记录并联系管理员核对' }
      assertCurrent()
      if (result.ok) {
        result.warning = [reply.message, result.warning].filter(Boolean).join('。')
        if (!result.persistencePending) { clearInboundPending(localStorage, context.key, record); pendingChanged() }
      }
      return result
    })
  } catch (error) { return inboundMutationFailure(error) }
}

/** Reading never clears an unresolved original or authorizes a stale form's version. */
export async function readInboundOriginal(order: InboundOrder): Promise<InboundMutationResult> {
  try {
    const context = pendingContext(order); context.assertSession()
    const erp = await fetchErpInbound(order.inboundNo); context.assertSession()
    const current = buildInboundOrderFromErp(erp, order.customerId)
    cacheInboundOrder(current)
    return { ok: true, order: current, warning: '已读取最新单据；待核对原请求仍保留，读取不会取消或再次提交作业。' }
  } catch (error) { return inboundMutationFailure(error) }
}

export async function submitInboundToErp(order: InboundOrder): Promise<InboundMutationResult> {
  return runOriginal(order, order.erpRevision ? 'reactivate' : 'create')
}

export async function updateInboundOnErp(order: InboundOrder): Promise<InboundMutationResult> { return runOriginal(order, 'update') }

export async function withdrawInboundOrder(order: InboundOrder): Promise<InboundMutationResult> {
  if (order.status !== 'on_the_way') return { ok: false, error: '仅在途入库单可撤回' }
  return runOriginal(order, 'withdraw')
}

export async function voidInboundOrder(order: InboundOrder): Promise<InboundMutationResult> {
  if (!canVoidInboundOrder(order.status)) return { ok: false, error: '仅草稿或在途入库单可作废' }
  if (order.status === 'on_the_way' || order.erpRevision) return runOriginal(order, 'void')
  try {
    const context = pendingContext(order, true)
    return await withInboundOperationLock(context.key, async () => {
      context.assertSession()
      if (readInboundPending(localStorage, context.key)) throw knownFailure('本单仍有待核对的原操作，请先处理原请求')
      const next = { ...order, status: 'voided' as InboundStatus }
      await upsertInboundOrderOrThrow(next, context.assertSession); context.assertSession()
      return { ok: true as const, order: next }
    })
  } catch (error) { return inboundMutationFailure(error) }
}

export async function reorderInboundOnErp(order: InboundOrder): Promise<InboundMutationResult> {
  if (!canReorderInboundOrder(order.status)) return { ok: false, error: '仅已作废的入库单可重新下单' }
  if (!order.lineItems?.length) return { ok: false, error: '请先确认入库货品后再提交' }
  return runOriginal(order, order.erpRevision ? 'reactivate' : 'create')
}

export async function refreshInboundsFromErp(customerId: string, isCurrent: () => boolean = () => true): Promise<number> {
  const scope = authSessionScope()
  const current = () => isCurrent() && authSessionScope() === scope
  if (!current()) return 0
  const customerCode = getCustomerCode(customerId)
  if (!customerCode || customerCode === '—') return 0
  const before = new Map(getInboundOrdersSnapshot().map(order => [order.inboundNo, order]))
  const data = await syncErpInbounds(customerCode)
  if (!current()) return 0
  if ((data.drafts !== undefined && !Array.isArray(data.drafts)) || (data.draftReadErrors !== undefined && !Array.isArray(data.draftReadErrors))) throw knownFailure('入库草稿读取结果无法识别，请保留记录并刷新重试', 502)
  const drafts = new Map((data.drafts || []).map(order => [order.inboundNo, order]))
  const errors = new Map((data.draftReadErrors || []).map(error => [error.inboundNo, error.message]))
  let applied = 0
  for (const item of data.items || []) {
    if (isErpPalletInbound(item)) continue
    const existing = getInboundOrdersSnapshot().find(order => order.inboundNo === item.inboundNo)
    // A write or another newer read finished while this request was in flight.
    if (existing !== before.get(item.inboundNo)) { errors.delete(item.inboundNo); continue }
    if (errors.has(item.inboundNo)) continue
    const cancelled = item.status === 'cancelled' || ['cancelled', 'voided'].includes(item.omsStatus)
    if (cancelled && existing?.status === 'draft' && data.drafts === undefined) {
      errors.set(item.inboundNo, `尚未读取到 ${item.inboundNo} 的已保存草稿，请保留记录并刷新后继续`)
      continue
    }
    const draft = cancelled && item.totalReceivedQty === 0 ? drafts.get(item.inboundNo) : undefined
    if (draft && (draft.customerId !== customerId || draft.status !== 'draft' || draft.receivedQty !== 0)) {
      errors.set(item.inboundNo, `草稿 ${item.inboundNo} 的客户或进度不匹配，请保留记录并核对`)
      continue
    }
    cacheInboundOrder(draft ? { ...draft, erpRevision: item.revision } : buildInboundOrderFromErp(item, customerId))
    applied++
  }
  if (errors.size) throw knownFailure(`已更新 ${applied} 条入库状态；以下草稿未覆盖：${[...errors.values()].join('；')}`, 409)
  return applied
}

export type { InboundOrder }
