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
let running = false
let lastRole: OmsRole | null = null

/** 静默拉取 ERP 最新履约/库存/余额/费用/公告到本地 store */
export async function syncErpNow(role: OmsRole): Promise<void> {
  if (isSysAdmin(role)) return
  const customerId = getCustomerIdForRole(role)
  const customerCode = getCustomerCode(customerId ?? undefined)
  if (!customerId || !customerCode || customerCode === '—') return
  if (running) return
  running = true
  try {
    await Promise.allSettled([
      refreshInboundsFromErp(customerId),
      refreshReturnsFromErp(customerId),
      refreshOutboundsFromErp(customerId),
      refreshLogisticsFromErp(customerCode),
      refreshInventoryFromErp(customerId, customerCode),
      refreshBillingFromErp(customerCode),
      getErpAnnouncements().then(r =>
        setAnnouncementsFromErp(
          r.items.map(a => ({
            id: a.id,
            title: a.title,
            date: a.date,
            type: a.type,
            category: a.category,
          })),
        ),
      ),
      refreshSystemMessagesFromServer(),
    ])
  } finally {
    running = false
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
