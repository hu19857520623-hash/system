import type { CustomerAccount } from '../data/mockData'
import type { CustomerAccountDto } from '../api/types'
import { apiPatch } from '../api/client'

let accounts: CustomerAccount[] = []
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(fn => fn())
}

export function subscribeAccounts(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getAccountsSnapshot() {
  return accounts
}

export function hydrateAccounts(list: CustomerAccountDto[]) {
  accounts = list.map(a => ({
    ...a,
    permissions: [...a.permissions],
  }))
  emit()
}

export function upsertAccount(account: CustomerAccountDto) {
  const next = { ...account, permissions: [...account.permissions] }
  accounts = accounts.some(item => item.id === account.id)
    ? accounts.map(item => item.id === account.id ? next : item)
    : [next, ...accounts]
  emit()
}

export async function persistAccount(id: string, patch: Partial<CustomerAccount>) {
  const before = accounts
  accounts = accounts.map(a => (a.id === id ? { ...a, ...patch } : a))
  emit()
  const next = accounts.find(a => a.id === id)
  if (!next) return
  try {
    await apiPatch(`/accounts/${id}`, next)
  } catch (error) {
    accounts = before
    emit()
    throw error
  }
}
