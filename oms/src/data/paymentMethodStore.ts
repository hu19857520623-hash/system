import { useSyncExternalStore } from 'react'
import { apiPut } from '../api/client'
import { DEFAULT_PAYMENT_METHODS, type PaymentMethod } from './feeTemplates'

let methods: PaymentMethod[] = DEFAULT_PAYMENT_METHODS.map(m => ({ ...m }))
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(fn => fn())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return methods
}

export function hydratePaymentMethods(list: PaymentMethod[] | null | undefined) {
  methods = (list?.length ? list : DEFAULT_PAYMENT_METHODS).map(m => ({ ...m }))
  methods.sort((a, b) => a.sortOrder - b.sortOrder)
  emit()
}

export function usePaymentMethods() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function getEnabledPaymentMethods(): PaymentMethod[] {
  return methods.filter(m => m.enabled).sort((a, b) => a.sortOrder - b.sortOrder)
}

export function updatePaymentMethods(next: PaymentMethod[]) {
  methods = next.map(m => ({ ...m })).sort((a, b) => a.sortOrder - b.sortOrder)
  emit()
  void apiPut('/payment-methods', methods).catch(err =>
    console.error('persist payment methods failed', err),
  )
}

export function updatePaymentMethod(id: string, patch: Partial<PaymentMethod>) {
  updatePaymentMethods(
    methods.map(m => m.id === id
      ? { ...m, ...patch, updatedAt: new Date().toISOString().slice(0, 10) }
      : m,
    ),
  )
}
