import { useSyncExternalStore } from 'react'
import { apiDelete, apiPatch, apiPut, type BootstrapData } from '../api/client'
import type {
  CodeMapping,
  InboundOrder,
  Order,
  PlatformSkuMapping,
  QcReport,
  StoreAccount,
  SystemMessage,
} from './mockData'
import type { ReturnOrder } from './returnStore'

export type AnnouncementItem = {
  id: string
  title: string
  date: string
  type: 'notice' | 'important' | 'system'
}

interface EntityState {
  ready: boolean
  error: string | null
  orders: Order[]
  inboundOrders: InboundOrder[]
  returnOrders: ReturnOrder[]
  stores: StoreAccount[]
  codeMappings: CodeMapping[]
  platformSkuMappings: PlatformSkuMapping[]
  qcReports: QcReport[]
  systemMessages: SystemMessage[]
  announcements: AnnouncementItem[]
  customerProfile: {
    name: string
    code: string
    contact: string
    warehouse: string
    creditBalance: number
    monthlySpent: number
    pendingBill: number
    budgetUsed: number
  } | null
}

const empty: EntityState = {
  ready: false,
  error: null,
  orders: [],
  inboundOrders: [],
  returnOrders: [],
  stores: [],
  codeMappings: [],
  platformSkuMappings: [],
  qcReports: [],
  systemMessages: [],
  announcements: [],
  customerProfile: null,
}

let state: EntityState = empty
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

export function hydrateEntities(data: BootstrapData) {
  state = {
    ready: true,
    error: null,
    orders: data.orders,
    inboundOrders: data.inboundOrders,
    returnOrders: data.returnOrders ?? [],
    stores: data.stores,
    codeMappings: data.codeMappings,
    platformSkuMappings: data.platformSkuMappings,
    qcReports: data.qcReports,
    systemMessages: data.systemMessages,
    announcements: data.announcements.map(a => ({
      id: a.id,
      title: a.title,
      date: a.date,
      type: a.type as AnnouncementItem['type'],
    })),
    customerProfile: data.billing
      ? {
          name: data.billing.name,
          code: data.billing.code,
          contact: data.billing.contact,
          warehouse: data.billing.warehouse,
          creditBalance: data.billing.creditBalance,
          monthlySpent: data.billing.monthlySpent,
          pendingBill: data.billing.pendingBill,
          budgetUsed: data.billing.budgetUsed,
        }
      : null,
  }
  emit()
}

export function setEntityError(error: string) {
  state = { ...state, ready: true, error }
  emit()
}

export function setPlatformSkuMappings(list: PlatformSkuMapping[]) {
  state = { ...state, platformSkuMappings: list }
  emit()
}

export function setInboundOrders(list: InboundOrder[]) {
  state = { ...state, inboundOrders: list }
  emit()
}

export function persistInboundOrders(list: InboundOrder[]) {
  setInboundOrders(list)
  void apiPut('/inbound-orders', list).catch(err => console.error('persist inbound failed', err))
}

export function addInboundOrder(order: InboundOrder) {
  persistInboundOrders([order, ...state.inboundOrders])
}

export function updateInboundOrder(id: string, patch: Partial<InboundOrder>) {
  persistInboundOrders(state.inboundOrders.map(o => (o.id === id ? { ...o, ...patch } : o)))
}

export function upsertInboundOrder(order: InboundOrder) {
  const idx = state.inboundOrders.findIndex(o => o.inboundNo === order.inboundNo || o.id === order.id)
  if (idx >= 0) {
    const next = [...state.inboundOrders]
    next[idx] = { ...next[idx], ...order }
    persistInboundOrders(next)
    return
  }
  persistInboundOrders([order, ...state.inboundOrders])
}

export function setOrders(list: Order[]) {
  state = { ...state, orders: list }
  emit()
}

export function persistOrders(list: Order[]) {
  setOrders(list)
  void apiPut('/orders', list).catch(err => console.error('persist orders failed', err))
}

export function updateOrder(id: string, patch: Partial<Order>) {
  persistOrders(state.orders.map(o => (o.id === id ? { ...o, ...patch } : o)))
}

export function getInboundOrdersSnapshot() {
  return state.inboundOrders
}

export function deleteReturnOrder(id: string) {
  const before = state.returnOrders
  setReturnOrders(state.returnOrders.filter(o => o.id !== id))
  void apiDelete(`/return-orders/${encodeURIComponent(id)}`).catch(err => {
    setReturnOrders(before)
    console.error('delete return failed', err)
  })
}

export function setReturnOrders(list: ReturnOrder[]) {
  state = { ...state, returnOrders: list }
  emit()
}

export function persistReturnOrders(list: ReturnOrder[]) {
  setReturnOrders(list)
  void apiPut('/return-orders', list).catch(err => console.error('persist return failed', err))
}

export function addReturnOrder(order: ReturnOrder) {
  persistReturnOrders([order, ...state.returnOrders])
}

export function updateReturnOrder(id: string, patch: Partial<ReturnOrder>) {
  persistReturnOrders(state.returnOrders.map(o => (o.id === id ? { ...o, ...patch } : o)))
}

export function upsertReturnOrder(order: ReturnOrder) {
  const idx = state.returnOrders.findIndex(o => o.returnNo === order.returnNo || o.id === order.id)
  if (idx >= 0) {
    const next = [...state.returnOrders]
    next[idx] = { ...next[idx], ...order }
    persistReturnOrders(next)
    return
  }
  persistReturnOrders([order, ...state.returnOrders])
}

export function getReturnOrdersSnapshot() {
  return state.returnOrders
}

export function useReturnOrders() {
  return useEntityStore().returnOrders
}

export function useEntityStore() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useOrders() {
  return useEntityStore().orders
}

export function useInboundOrders() {
  return useEntityStore().inboundOrders
}

export function useStores() {
  return useEntityStore().stores
}

export function useCodeMappings() {
  return useEntityStore().codeMappings
}

export function usePlatformSkuMappings() {
  return useEntityStore().platformSkuMappings
}

export function useQcReports() {
  return useEntityStore().qcReports
}

export function useSystemMessages() {
  return useEntityStore().systemMessages
}

export function useAnnouncements() {
  return useEntityStore().announcements
}

/** 用 ERP 公告覆盖本地展示（内存；webhook 已落库） */
export function setAnnouncementsFromErp(
  items: { id: string | number; title: string; date: string; type?: string; category?: string }[],
) {
  state = {
    ...state,
    announcements: items.map(a => ({
      id: String(a.id),
      title: a.title,
      date: a.date,
      type: mapAnnType(a.type || a.category),
    })),
  }
  emit()
}

function mapAnnType(raw?: string): AnnouncementItem['type'] {
  const t = String(raw || '').toLowerCase()
  if (t.includes('重要') || t === 'important') return 'important'
  if (t.includes('系统') || t === 'system') return 'system'
  return 'notice'
}

export function prependSystemMessage(msg: SystemMessage) {
  if (state.systemMessages.some(m => m.id === msg.id)) return
  state = { ...state, systemMessages: [msg, ...state.systemMessages] }
  emit()
}

export function setSystemMessages(list: SystemMessage[]) {
  state = { ...state, systemMessages: list.map(m => ({ ...m })) }
  emit()
}

export async function markSystemMessagesRead(ids?: string[]): Promise<number> {
  const targets = ids?.length
    ? new Set(ids)
    : new Set(state.systemMessages.filter(message => !message.read).map(message => message.id))
  if (targets.size === 0) return 0
  const before = state.systemMessages
  setSystemMessages(before.map(message => targets.has(message.id) ? { ...message, read: true } : message))
  try {
    const result = await apiPatch<{ count: number }>('/system-messages/read', ids?.length ? { ids } : { all: true })
    return result.count
  } catch (error) {
    setSystemMessages(before)
    throw error
  }
}

export async function refreshSystemMessagesFromServer(): Promise<void> {
  const { apiGet } = await import('../api/client')
  const rows = await apiGet<SystemMessage[]>('/system-messages')
  setSystemMessages(rows)
}

export function useCustomerProfile() {
  return useEntityStore().customerProfile
}

export function getOrdersSnapshot() {
  return state.orders
}

export function getStoresSnapshot() {
  return state.stores
}

export function getPlatformSkuMappingsSnapshot() {
  return state.platformSkuMappings
}

export function isDataReady() {
  return state.ready
}
