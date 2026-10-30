import { readRecharge, runRecharge, newRechargeNo, type RechargeAttempt } from './rechargeWorkflow'
import { userFacingError } from '../utils/userFacingError'
import { useSyncExternalStore } from 'react'
import { authSessionScope, getStoredAuthSession } from '../api/client'
import { createErpRecharge, getErpBillingSnapshot, type ErpBillingSnapshot } from '../api/erp'
import type { FeeRecord } from './mockData'
import type { OutboundFeeLine } from './feeTemplates'

interface BillingState {
  creditBalance: number
  feeRecords: FeeRecord[]
  readWarning?: string
  snapshot?: ErpBillingSnapshot
}

let state: BillingState = { creditBalance: 0, feeRecords: [] }
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(fn => fn())
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
    readWarning: next.readWarning,
    snapshot: next.snapshot,
  }
  emit()
}

export function useBilling() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function getCreditBalance(): number {
  return state.creditBalance
}

/** Balance is read from ERP; applying it locally never writes a financial snapshot. */
export async function setCreditBalanceFromErp(balance: number, expectedCustomerCode?: string) {
  const user = getStoredAuthSession()?.user
  if (expectedCustomerCode && user?.customerCode !== expectedCustomerCode) throw new Error('客户身份已变化，请使用原账号重新读取余额')
  if (!Number.isFinite(balance)) throw new Error('余额读取结果无效，请重新读取后继续')
  state = { ...state, creditBalance: round2(balance), readWarning: undefined };emit()
}

export function getFeeRecords(): FeeRecord[] { return state.feeRecords }


let readGeneration = 0
let activeRead: { generation: number; scope: string; code: string; result: Promise<ErpBillingSnapshot> } | undefined
function newerBillingRead(code: string, scope: string, generation: number) {
  return scope === authSessionScope() && activeRead && activeRead.generation > generation && activeRead.scope === scope && activeRead.code === code
    ? activeRead.result : undefined
}
export async function refreshBillingFromServer(): Promise<ErpBillingSnapshot> {
  const code = getStoredAuthSession()?.user.customerCode
  if (!code) throw new Error('请先选择客户，再读取账务')
  return refreshBillingFromErp(code)
}

/** One read-only ERP snapshot, with no browser-generated financial rows or fallback success. */
export async function refreshBillingFromErp(customerCode: string): Promise<ErpBillingSnapshot> {
  const user = getStoredAuthSession()?.user, code = customerCode.trim().toUpperCase()
  const scope = authSessionScope()
  if (!user || (user.role !== 'sys_admin' && user.customerCode !== code)) throw new Error('请使用当前客户身份读取账务，不能跨客户读取')
  const generation = ++readGeneration
  const result = readErpBillingSnapshot(code, scope, generation, user.role !== 'sys_admin')
  activeRead = { generation, scope, code, result }
  return result
}

async function readErpBillingSnapshot(code: string, scope: string, generation: number, applyToWallet: boolean): Promise<ErpBillingSnapshot> {
  let snapshot: ErpBillingSnapshot
  try { snapshot = await getErpBillingSnapshot(code) }
  catch (error) {
    const replacement = newerBillingRead(code, scope, generation)
    if (replacement) return replacement
    if (applyToWallet && scope === authSessionScope() && generation === readGeneration) {
      state = { ...state, readWarning: '最新账务读取失败，当前保留上次结果，请重新读取后核对' };emit()
    }
    throw error
  }
  if (scope !== authSessionScope()) throw new Error('登录身份或权限已变化，请使用原账号重新读取账务')
  if (generation !== readGeneration) {
    const replacement = newerBillingRead(code, scope, generation)
    if (replacement) return replacement
    throw new Error('已有其它客户的账务读取请求，请核对当前客户后重新读取')
  }
  if (snapshot.customerCode !== code || !Array.isArray(snapshot.feeRecords) || !Array.isArray(snapshot.bills) || !Number.isFinite(snapshot.creditBalance) || !Number.isFinite(snapshot.monthlySpent) || !Number.isFinite(snapshot.pendingBill)) throw new Error('账务读取结果不完整，请重新读取后继续')
  if (applyToWallet) hydrateBilling({ creditBalance: snapshot.creditBalance, feeRecords: snapshot.feeRecords, snapshot })
  return snapshot
}

export function rechargeScope() {
  const user = getStoredAuthSession()?.user
  if (!user?.id || !user.customerCode) throw new Error('请使用原客户账号核对充值')
  return `oms:${JSON.stringify([user.id, user.customerCode])}`
}
export function pendingRecharge() { return readRecharge(localStorage, rechargeScope()) }
/** A failed or unknown request must keep its original immutable recharge number. */
export async function rechargeViaErp(params: { customerCode: string; amount: number; paymentMethodId?: string; paymentMethodTitle?: string }, retry = false): Promise<{ ok: true; balance: number; pending: boolean; message: string } | { ok: false; error: string }> {
  const user = getStoredAuthSession()?.user
  if (!user || user.customerCode !== params.customerCode) return { ok: false, error: '请使用原客户账号核对充值' }
  try {
    const scope = rechargeScope(), original = readRecharge(localStorage, scope)
    if (retry && !original) throw new Error('原充值已核对完成或已被其它页面处理，请重新读取充值记录，勿再次充值')
    if (original && !retry) throw new Error('还有原充值待核对，请点击重试原充值，勿再次充值')
    const attempt: RechargeAttempt = original || { ...params, rechargeNo: newRechargeNo(), paymentMethod: params.paymentMethodId || 'bank' }
    const response = await runRecharge(localStorage, scope, attempt, async body => {
      const result = await createErpRecharge(body.customerCode, body)
      if (getStoredAuthSession()?.user.id !== user.id || getStoredAuthSession()?.user.customerCode !== user.customerCode) throw new Error('登录身份已变化，请使用原账号核对')
      // Read current source-ledger state before clearing the original retry.
      try { await refreshBillingFromErp(user.customerCode) }
      catch (error) { throw new Error(`充值已返回，最新账务读取尚未完成，请保留原单重试核对。${userFacingError(error)}`) }
      return result
    })
    return { ok: true, balance: state.creditBalance, pending: !response.completed, message: response.message }
  } catch (error) { return { ok: false, error: userFacingError(error) } }
}

/** Legacy clients must use the order workflow, which owns reservation and refund transactions. */
export async function preDeductOutboundFees(_outboundNo: string, _feeLines: OutboundFeeLine[], _customerCode?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return { ok: false, error: '请刷新页面后通过出库预约提交，预扣由出库单统一处理' }
}
export async function rollbackPreDeductOutboundFees(_outboundNo: string): Promise<number> {
  throw new Error('请通过出库单撤回或取消并核对预扣退还，勿直接调整账务')
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
