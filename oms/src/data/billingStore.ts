import { useSyncExternalStore } from 'react'
import { apiDelete, apiGet, apiPut } from '../api/client'
import {
  createErpRecharge,
  getErpCharges,
  getErpRecharges,
  type ErpChargeItem,
  type ErpRechargeItem,
} from '../api/erp'
import type { FeeRecord } from './mockData'
import type { OutboundFeeLine } from './feeTemplates'

interface BillingState {
  creditBalance: number
  feeRecords: FeeRecord[]
}

let state: BillingState = { creditBalance: 0, feeRecords: [] }
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(fn => fn())
}

function persist(next: BillingState) {
  state = next
  emit()
  void apiPut('/billing', next).catch(err => console.error('persist billing failed', err))
}

async function persistOrThrow(next: BillingState) {
  const previous = state
  state = next
  emit()
  try {
    await apiPut('/billing', next)
  } catch (error) {
    state = previous
    emit()
    throw error
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return state
}

export function hydrateBilling(next: BillingState) {
  state = {
    creditBalance: next.creditBalance,
    feeRecords: structuredClone(next.feeRecords),
  }
  emit()
}

export function useBilling() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function getCreditBalance(): number {
  return state.creditBalance
}

/** 用 ERP 权威余额覆盖本地展示并持久化，刷新后不回退旧余额。 */
export async function setCreditBalanceFromErp(balance: number) {
  await persistOrThrow({ ...state, creditBalance: round2(balance) })
}

export function getFeeRecords(): FeeRecord[] {
  return state.feeRecords
}

function mapChargeType(chargeType: string): FeeRecord['type'] {
  if (chargeType === 'storage') return 'storage'
  if (chargeType === 'outbound_ship') return 'shipping'
  if (chargeType === 'relabel') return 'relabel'
  if (chargeType === 'picking') return 'picking'
  if (chargeType === 'inspection') return 'inspection'
  if (chargeType === 'other') return 'other'
  return 'handling'
}

function chargeToFee(c: ErpChargeItem): FeeRecord {
  const date = String(c.chargeDate || '').slice(0, 10)
  return {
    id: `erp-chg-${c.id}`,
    date: date || new Date().toISOString().slice(0, 10),
    type: mapChargeType(c.chargeType),
    refNo: c.bizRef || c.chargeNo || '—',
    desc: c.description || c.chargeTypeLabel || c.chargeType,
    amount: -Math.abs(Number(c.amount) || 0),
    method: 'actual',
    customerCode: c.customerCode || undefined,
  }
}

function rechargeToFee(r: ErpRechargeItem, customerCode?: string): FeeRecord {
  const date = String(r.createdAt || '').slice(0, 10)
  return {
    id: `erp-rc-${r.rechargeNo}`,
    date: date || new Date().toISOString().slice(0, 10),
    type: 'recharge',
    refNo: r.rechargeNo,
    desc: r.remark || `充值 · ${r.paymentMethod}`,
    amount: Math.abs(Number(r.amount) || 0),
    method: 'actual',
    customerCode,
    rechargeNo: r.rechargeNo,
    paymentMethodTitle: r.paymentMethod,
  }
}

/** 从 OMS 服务端拉取费用流水（含 Webhook 对账结果） */
export async function refreshBillingFromServer(): Promise<void> {
  try {
    const data = await apiGet<{ creditBalance: number; feeRecords: FeeRecord[] }>('/billing')
    hydrateBilling({
      creditBalance: data.creditBalance,
      feeRecords: data.feeRecords,
    })
  } catch (err) {
    console.error('refreshBillingFromServer failed', err)
  }
}

/** 从 ERP 拉取费用 + 充值流水，保留本地预扣与对账记录 */
export async function refreshBillingFromErp(customerCode: string): Promise<void> {
  await refreshBillingFromServer()
  const localBalance = state.creditBalance
  const [charges, recharges] = await Promise.all([
    getErpCharges(customerCode),
    getErpRecharges(customerCode),
  ])
  const erpFees = [
    ...recharges.items.map(r => rechargeToFee(r, customerCode)),
    ...charges.items.map(chargeToFee),
  ]
  const localKeep = state.feeRecords.filter(
    f =>
      f.method === 'pre_deduct' ||
      f.method === 'settlement_adjust' ||
      f.id.startsWith('pd-') ||
      f.id.startsWith('settle-') ||
      f.id.startsWith('refund-') ||
      f.id.startsWith('local-'),
  )
  const seen = new Set(erpFees.map(f => f.id))
  const merged = [...erpFees, ...localKeep.filter(f => !seen.has(f.id))].sort((a, b) =>
    b.date.localeCompare(a.date),
  )
  persist({
    creditBalance: round2(localBalance),
    feeRecords: merged,
  })
}

/** OMS 自助充值 → ERP 即时到账 */
export async function rechargeViaErp(params: {
  customerCode: string
  amount: number
  paymentMethodId?: string
  paymentMethodTitle?: string
}): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
  const amount = Number(params.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: '请输入有效充值金额' }
  }
  try {
    const result = await createErpRecharge(params.customerCode, {
      amount,
      paymentMethod: params.paymentMethodId || 'bank',
      paymentMethodId: params.paymentMethodId,
      paymentMethodTitle: params.paymentMethodTitle,
    })
    const fee = rechargeToFee(result.record, result.customerCode)
    if (params.paymentMethodTitle) fee.paymentMethodTitle = params.paymentMethodTitle
    if (params.paymentMethodId) fee.paymentMethodId = params.paymentMethodId
    const withoutDup = state.feeRecords.filter(f => f.id !== fee.id && f.rechargeNo !== fee.rechargeNo)
    persist({
      creditBalance: round2(result.balance),
      feeRecords: [fee, ...withoutDup],
    })
    return { ok: true, balance: result.balance }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 出库提交时预扣款：余额不足则返回 false */
export async function preDeductOutboundFees(
  outboundNo: string,
  feeLines: OutboundFeeLine[],
  customerCode?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const total = feeLines.reduce((s, f) => s + f.amount, 0)
  if (total <= 0) return { ok: true }

  if (state.creditBalance < total) {
    return {
      ok: false,
      error: `账户余额不足，需预扣 ¥${total.toFixed(2)}，当前余额 ¥${state.creditBalance.toFixed(2)}，请先充值`,
    }
  }

  const date = new Date().toISOString().slice(0, 10)
  const newRecords: FeeRecord[] = feeLines.map((f, i) => ({
    id: `pd-${Date.now()}-${i}`,
    date,
    type: f.type,
    refNo: outboundNo,
    desc: `预扣 · ${f.detail}`,
    amount: -f.amount,
    method: 'pre_deduct',
    customerCode: customerCode || undefined,
  }))

  try {
    await persistOrThrow({
      creditBalance: round2(state.creditBalance - total),
      feeRecords: [...newRecords, ...state.feeRecords],
    })
  } catch (error) {
    return {
      ok: false,
      error: `预扣保存失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }

  return { ok: true }
}

/** ERP 创建失败时回滚本次 OMS 预扣，避免仅本地扣款。 */
export async function rollbackPreDeductOutboundFees(outboundNo: string): Promise<number> {
  const matched = state.feeRecords.filter(
    f => f.refNo === outboundNo && f.method === 'pre_deduct',
  )
  const total = round2(matched.reduce((sum, fee) => sum + Math.abs(fee.amount), 0))
  if (total <= 0) return 0
  const result = await apiDelete<{ refunded: number; creditBalance: number }>(
    `/billing/pre-deduct/${encodeURIComponent(outboundNo)}`,
  )
  state = {
    creditBalance: result.creditBalance,
    feeRecords: state.feeRecords.filter(
      f => !(f.refNo === outboundNo && f.method === 'pre_deduct'),
    ),
  }
  emit()
  return round2(result.refunded)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
