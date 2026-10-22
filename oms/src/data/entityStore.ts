import { useSyncExternalStore } from 'react'
import { apiDelete, apiPatch, apiPut, type BootstrapData } from '../api/client'
import type {
  InboundOrder,
  Order,
  PlatformSkuMapping,
  StoreAccount,
  SystemMessage,
} from './mockData'
import type { ReturnOrder } from './returnStore'
import { notifyPersistFailed } from '../utils/userNotify'
import { mergeInboundOrder, reconcileInboundIds } from './inboundOrderIdentity'

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
  platformSkuMappings: PlatformSkuMapping[]
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
  platformSkuMappings: [],
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
    platformSkuMappings: data.platformSkuMappings,
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
  void saveInboundOrders(list).catch(err => notifyPersistFailed('入库单', err))
}

async function saveInboundOrders(list: InboundOrder[]) {
  const result = await apiPut<{ identities?: { id: string; inboundNo: string }[] }>('/inbound-orders', list)
  if (result.identities?.length) setInboundOrders(reconcileInboundIds(state.inboundOrders, result.identities))
}

export async function persistInboundOrdersOrThrow(list: InboundOrder[]) {
  const before = state.inboundOrders
  setInboundOrders(list)
  try {
    await saveInboundOrders(list)
  } catch (err) {
    setInboundOrders(before)
    throw err
  }
}

function nextInboundOrdersWithUpsert(order: InboundOrder, base = state.inboundOrders) {
  return mergeInboundOrder(order, base)
}

/** ERP polling updates the view; database persistence belongs to explicit saves/webhooks. */
export function cacheInboundOrder(order: InboundOrder) {
  setInboundOrders(nextInboundOrdersWithUpsert(order))
}

export function addInboundOrder(order: InboundOrder) {
  persistInboundOrders([order, ...state.inboundOrders])
}

export async function addInboundOrderOrThrow(order: InboundOrder) {
  await addInboundOrdersOrThrow([order])
}

/** 新导入的草稿在一次服务端事务中保存，不回写其他未修改单据的旧快照。 */
export async function addInboundOrdersOrThrow(orders: InboundOrder[]) {
  if (!orders.length) return
  const before = state.inboundOrders
  const next = orders.reduce((list, order) => nextInboundOrdersWithUpsert(order, list), before)
  setInboundOrders(next)
  try {
    await saveInboundOrders(orders)
  } catch (error) {
    const imported = new Set(orders.map(order => order.inboundNo))
    const optimistic = new Map(next.map(order => [order.inboundNo, order]))
    const previous = new Map(before.map(order => [order.inboundNo, order]))
    // 等待期间由 ERP 刷新过的记录继续采用新值，失败只撤销仍属于本次保存的乐观值。
    setInboundOrders(state.inboundOrders.flatMap(order => {
      if (!imported.has(order.inboundNo) || order !== optimistic.get(order.inboundNo)) return [order]
      const old = previous.get(order.inboundNo)
      return old ? [old] : []
    }))
    throw error
  }
}

export function updateInboundOrder(id: string, patch: Partial<InboundOrder>) {
  persistInboundOrders(state.inboundOrders.map(o => (o.id === id ? { ...o, ...patch } : o)))
}

export async function updateInboundOrderOrThrow(id: string, patch: Partial<InboundOrder>) {
  const order = state.inboundOrders.find(item => item.id === id)
  if (!order) throw new Error('未找到该入库单，请刷新后重试')
  await addInboundOrdersOrThrow([{ ...order, ...patch }])
}

export function upsertInboundOrder(order: InboundOrder) {
  persistInboundOrders(nextInboundOrdersWithUpsert(order))
}

export async function upsertInboundOrderOrThrow(order: InboundOrder) {
  await addInboundOrdersOrThrow([order])
}

export function setOrders(list: Order[]) {
  state = { ...state, orders: list }
  emit()
}

export function persistOrders(list: Order[]) {
  setOrders(list)
  void apiPut('/orders', list).catch(err => notifyPersistFailed('订单', err))
}

export function updateOrder(id: string, patch: Partial<Order>) {
  persistOrders(state.orders.map(o => (o.id === id ? { ...o, ...patch } : o)))
}

export function getInboundOrdersSnapshot() {
  return state.inboundOrders
}

export async function deleteReturnOrder(id: string) {
  const before = state.returnOrders.find(order => order.id === id)
  setReturnOrders(state.returnOrders.filter(o => o.id !== id))
  try {
    await apiDelete(`/return-orders/${encodeURIComponent(id)}`)
  } catch (error) {
    if (before && !state.returnOrders.some(order => order.id === before.id || order.returnNo === before.returnNo)) {
      setReturnOrders([before, ...state.returnOrders])
    }
    throw error
  }
}

export function setReturnOrders(list: ReturnOrder[]) {
  state = { ...state, returnOrders: list }
  emit()
}

export function persistReturnOrders(list: ReturnOrder[], changed = list) {
  setReturnOrders(list)
  void apiPut('/return-orders', changed).catch(err => notifyPersistFailed('退件单', err))
}

export async function persistReturnOrdersOrThrow(list: ReturnOrder[], changed = list) {
  const before = state.returnOrders
  setReturnOrders(list)
  try {
    await apiPut('/return-orders', changed)
  } catch (err) {
    const affected = new Set(changed.map(order => order.returnNo))
    const optimistic = new Map(list.map(order => [order.returnNo, order]))
    const previous = new Map(before.map(order => [order.returnNo, order]))
    setReturnOrders(state.returnOrders.flatMap(order => {
      if (!affected.has(order.returnNo) || order !== optimistic.get(order.returnNo)) return [order]
      const old = previous.get(order.returnNo)
      return old ? [old] : []
    }))
    throw err
  }
}

function nextReturnOrdersWithUpsert(order: ReturnOrder, base = state.returnOrders) {
  const idx = base.findIndex(o => o.returnNo === order.returnNo || o.id === order.id)
  if (idx >= 0) {
    const next = [...base]
    next[idx] = { ...next[idx], ...order }
    return next
  }
  return [order, ...base.filter(o => o.id !== order.id && o.returnNo !== order.returnNo)]
}

export function addReturnOrder(order: ReturnOrder) {
  upsertReturnOrder(order)
}

export async function addReturnOrderOrThrow(order: ReturnOrder) {
  await upsertReturnOrderOrThrow(order)
}

export async function addReturnOrdersOrThrow(orders: ReturnOrder[]) {
  if (!orders.length) return
  const next = orders.reduce((list, order) => nextReturnOrdersWithUpsert(order, list), state.returnOrders)
  await persistReturnOrdersOrThrow(next, orders)
}

export function updateReturnOrder(id: string, patch: Partial<ReturnOrder>) {
  const next = state.returnOrders.map(o => (o.id === id ? { ...o, ...patch } : o))
  persistReturnOrders(next, next.filter(order => order.id === id))
}

export async function updateReturnOrderOrThrow(id: string, patch: Partial<ReturnOrder>) {
  const next = state.returnOrders.map(o => (o.id === id ? { ...o, ...patch } : o))
  await persistReturnOrdersOrThrow(next, next.filter(order => order.id === id))
}

export function upsertReturnOrder(order: ReturnOrder) {
  cacheReturnOrder(order)
  void apiPut('/return-orders', [order]).catch(err => notifyPersistFailed('退件单', err))
}

export async function upsertReturnOrderOrThrow(order: ReturnOrder) {
  await addReturnOrdersOrThrow([order])
}

export function cacheReturnOrder(order: ReturnOrder) {
  setReturnOrders(nextReturnOrdersWithUpsert(order))
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

export function usePlatformSkuMappings() {
  return useEntityStore().platformSkuMappings
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
