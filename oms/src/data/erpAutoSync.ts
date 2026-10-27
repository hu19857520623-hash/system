import { canReadData } from '../data/readAccess'
import { authSessionScope, getStoredAuthSession } from '../api/client'
import { getCustomerCode, getCustomerIdForRole, isSysAdmin } from './dataScope'
import type { OmsRole } from '../auth/permissions'
import { refreshInboundsFromErp } from './inboundStore'
import { refreshReturnsFromErp } from './returnStore'
import { refreshOutboundsFromErp } from './outboundStore'
import { refreshLogisticsFromErp } from './logisticsStore'
import { refreshInventoryFromErp } from './inventoryStore'
import { getErpAnnouncements } from '../api/erp'
import { refreshBillingFromErp } from './billingStore'
import { setAnnouncementsFromErp, refreshSystemMessagesFromServer } from './entityStore'

const DEFAULT_INTERVAL_MS = 15_000

let timer: ReturnType<typeof setInterval> | null = null
let flight: { scope: string } | null = null
let lastRole: OmsRole | null = null

/** 静默拉取 ERP 最新履约/库存/余额/费用/公告到本地 store */
export async function syncErpNow(role: OmsRole): Promise<void> {
  const session = getStoredAuthSession()
  if (!session || session.user.role !== role || isSysAdmin(role)) return
  const customerId = getCustomerIdForRole(role)
  const customerCode = getCustomerCode(customerId ?? undefined)
  if (!customerId || !customerCode || customerCode === '—') return
  const scope = authSessionScope(session)
  if (flight?.scope === scope) return
  const request = { scope }; flight = request
  const allowed = (resource: Parameters<typeof canReadData>[1]) => canReadData(session.user, resource)
  try {
    await Promise.allSettled([
      allowed('inboundOrders') ? refreshInboundsFromErp(customerId) : undefined,
      allowed('returnOrders') ? refreshReturnsFromErp(customerId) : undefined,
      allowed('outboundOrders') ? refreshOutboundsFromErp(customerId) : undefined,
      allowed('logistics') ? refreshLogisticsFromErp(customerCode) : undefined,
      allowed('inventory') ? refreshInventoryFromErp(customerId, customerCode) : undefined,
      allowed('billing') ? refreshBillingFromErp(customerCode) : undefined,
      allowed('messages') ? getErpAnnouncements().then(r =>
        setAnnouncementsFromErp(
          r.items.map(a => ({
            id: a.id,
            title: a.title,
            date: a.date,
            type: a.type,
            category: a.category,
          })),
        ),
      ) : undefined,
      allowed('messages') ? refreshSystemMessagesFromServer() : undefined,
    ])
  } finally {
    if (flight === request) flight = null
  }
}

/** 启动后台自动同步（页面打开期间） */
export function startErpAutoSync(role: OmsRole, intervalMs = DEFAULT_INTERVAL_MS) {
  lastRole = role
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (isSysAdmin(role)) return

  void syncErpNow(role)
  timer = setInterval(() => {
    if (lastRole) void syncErpNow(lastRole)
  }, intervalMs)

  const onFocus = () => {
    if (lastRole) void syncErpNow(lastRole)
  }
  window.addEventListener('focus', onFocus)
  return () => {
    window.removeEventListener('focus', onFocus)
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

export function stopErpAutoSync() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  lastRole = null
}
