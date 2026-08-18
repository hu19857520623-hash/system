const API_BASE = '/api'
const LOCAL_SESSION_KEY = 'oms-auth-session'
const SESSION_SESSION_KEY = 'oms-auth-session-tab'

export type SessionUser = {
  id: string
  username: string
  email: string
  status: string
  role: import('../auth/permissions').OmsRole
  customerId: string | null
  customerCode: string
  permissions: import('../auth/permissions').Permission[]
  mustChangePassword: boolean
  name: string
  type: import('../auth/permissions').CustomerAccountType | null
  warehouse: string
}

export type AuthSession = {
  token: string
  user: SessionUser
}

export type AuthLoginRequest = {
  username: string
  password: string
  remember?: boolean
}

export type AuthChangePasswordRequest = {
  currentPassword: string
  newPassword: string
}

export type AuthLogoutResponse = { ok: true }

export type OmsAccountProvisionRequest = {
  customerCode?: string
  customerName: string
  companyName?: string
  contactEmail: string
  contactName?: string
  contactPhone?: string
  omsType: 'ecommerce' | 'catalog' | 'hybrid'
  warehouse: string
  permissions: import('../auth/permissions').Permission[]
  username: string
  temporaryPassword: string
}

export type OmsPortalAccountDto = {
  id: string
  customerId: string
  username: string
  loginEmail?: string
  role: 'ecommerce' | 'catalog' | 'hybrid'
  status: 'active' | 'disabled'
  mustChangePassword: boolean
}

export type OmsAccountProvisionResponse = {
  customer: {
    id: number | string
    customerCode: string
    customerName: string
    companyName?: string | null
    contactEmail?: string | null
    contactName?: string | null
    contactPhone?: string | null
    status?: number | string
  }
  portalAccount: OmsPortalAccountDto
}

export type OmsResetPasswordRequest = {
  username?: string
  temporaryPassword: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeSessionUser(value: unknown): SessionUser {
  const raw = asRecord(value)
  if (!raw) throw new Error('登录响应缺少用户信息')

  // userId/username/loginEmail are accepted while older OMS API deployments roll over.
  const id = optionalString(raw.id ?? raw.userId)
  const username = optionalString(raw.username ?? raw.email ?? raw.loginEmail).toLowerCase()
  const role = optionalString(raw.role)
  if (!id || !username || !['sys_admin', 'ecommerce', 'catalog', 'hybrid'].includes(role)) {
    throw new Error('登录响应中的用户身份无效')
  }

  const customerId = optionalString(raw.customerId) || null
  const customerCode = optionalString(raw.customerCode)
  if (role !== 'sys_admin' && (!customerId || !customerCode)) {
    throw new Error('登录响应缺少客户身份')
  }

  const rawType = optionalString(raw.type)
  const type = ['ecommerce', 'catalog', 'hybrid'].includes(rawType)
    ? rawType as SessionUser['type']
    : role === 'sys_admin'
      ? null
      : role as SessionUser['type']

  return {
    id,
    username,
    email: username,
    status: optionalString(raw.status) || 'active',
    role: role as SessionUser['role'],
    customerId,
    customerCode,
    permissions: Array.isArray(raw.permissions)
      ? raw.permissions.filter(permission => typeof permission === 'string') as SessionUser['permissions']
      : [],
    mustChangePassword: Boolean(raw.mustChangePassword),
    name: optionalString(raw.name) || username,
    type,
    warehouse: optionalString(raw.warehouse),
  }
}

export function normalizeAuthSession(value: unknown, fallbackToken = ''): AuthSession {
  const raw = asRecord(value)
  if (!raw) throw new Error('登录响应无效')
  const token = optionalString(raw.token) || fallbackToken
  if (!token) throw new Error('登录响应缺少访问令牌')
  return {
    token,
    user: normalizeSessionUser(raw.user),
  }
}

export function getStoredAuthSession(): AuthSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_SESSION_KEY)
      || localStorage.getItem(LOCAL_SESSION_KEY)
    return raw ? normalizeAuthSession(JSON.parse(raw)) : null
  } catch {
    localStorage.removeItem(LOCAL_SESSION_KEY)
    sessionStorage.removeItem(SESSION_SESSION_KEY)
    return null
  }
}

export function isPersistentAuthSession() {
  return Boolean(localStorage.getItem(LOCAL_SESSION_KEY))
}

function describeOmsNetworkError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  if (
    err instanceof TypeError
    || /failed to fetch|fetch failed|networkerror|econnrefused|econnreset/i.test(msg)
  ) {
    const error = new Error(
      '无法连接 OMS 服务（127.0.0.1:3001）。请运行仓库根目录 dev-local.ps1，或单独启动 oms。',
    ) as Error & { code?: string }
    error.code = 'NETWORK'
    return error
  }
  return err instanceof Error ? err : new Error(msg)
}

export function storeAuthSession(session: AuthSession | null, remember = true) {
  localStorage.removeItem(LOCAL_SESSION_KEY)
  sessionStorage.removeItem(SESSION_SESSION_KEY)
  if (!session) return
  const storage = remember ? localStorage : sessionStorage
  storage.setItem(remember ? LOCAL_SESSION_KEY : SESSION_SESSION_KEY, JSON.stringify(session))
}

export async function fetchWithAuth(url: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  const token = getStoredAuthSession()?.token
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let response: Response
  try {
    response = await fetch(url, { ...init, headers })
  } catch (err) {
    throw describeOmsNetworkError(err)
  }
  if (response.status === 401) {
    storeAuthSession(null)
    window.dispatchEvent(new Event('oms:unauthorized'))
  }
  return response
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredAuthSession()?.token
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type') && init?.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
    })
  } catch (err) {
    throw describeOmsNetworkError(err)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let message = text
    try {
      const json = JSON.parse(text) as { error?: string; message?: string }
      message = json.error || json.message || text
    } catch {
      /* keep raw text */
    }
    if (res.status === 401 && path !== '/auth/login') {
      storeAuthSession(null)
      window.dispatchEvent(new Event('oms:unauthorized'))
    }
    const error = new Error(message || `API ${path} failed: ${res.status}`) as Error & {
      status?: number
    }
    error.status = res.status
    throw error
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export function apiGet<T>(path: string) {
  return request<T>(path)
}

export function apiPut<T>(path: string, body: unknown) {
  return request<T>(path, { method: 'PUT', body: JSON.stringify(body) })
}

export function apiPost<T>(path: string, body: unknown) {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

export function apiPatch<T>(path: string, body: unknown) {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
}

export function apiDelete<T>(path: string) {
  return request<T>(path, { method: 'DELETE' })
}

export async function loginOms(body: AuthLoginRequest): Promise<AuthSession> {
  return normalizeAuthSession(await request<unknown>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
  }))
}

export function getOmsSessionUser() {
  return request<unknown>('/auth/me').then(response => {
    const record = asRecord(response)
    return normalizeSessionUser(record?.user ?? response)
  })
}

export async function changeOmsPassword(
  body: AuthChangePasswordRequest,
): Promise<AuthSession> {
  return normalizeAuthSession(await request<unknown>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify(body),
  }))
}

export function logoutOms() {
  return request<AuthLogoutResponse>('/auth/logout', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function provisionOmsAccount(body: OmsAccountProvisionRequest) {
  return request<OmsAccountProvisionResponse>('/accounts', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function resetOmsAccountPassword(accountId: string, body: OmsResetPasswordRequest) {
  return request<OmsPortalAccountDto>(
    `/accounts/${encodeURIComponent(accountId)}/reset-password`,
    { method: 'POST', body: JSON.stringify(body) },
  )
}

export type BootstrapData = {
  accounts: import('./types').CustomerAccountDto[]
  billing: {
    creditBalance: number
    monthlySpent: number
    pendingBill: number
    budgetUsed: number
    name: string
    code: string
    contact: string
    warehouse: string
  } | null
  feeRecords: import('../data/mockData').FeeRecord[]
  stores: import('../data/mockData').StoreAccount[]
  products: import('../data/mockData').Product[]
  inventory: import('../data/mockData').InventoryItem[]
  orders: import('../data/mockData').Order[]
  inboundOrders: import('../data/mockData').InboundOrder[]
  returnOrders: import('../data/returnStore').ReturnOrder[]
  outboundOrders: import('../data/mockData').OutboundOrder[]
  codeMappings: import('../data/mockData').CodeMapping[]
  platformSkuMappings: import('../data/mockData').PlatformSkuMapping[]
  logistics: import('../data/mockData').LogisticsRecord[]
  qcReports: import('../data/mockData').QcReport[]
  systemMessages: import('../data/mockData').SystemMessage[]
  announcements: { id: string; title: string; date: string; type: string }[]
  feeTemplates: {
    priceTemplate: import('../data/feeTemplates').PriceTemplate | null
    priceTemplates: import('../data/feeTemplates').PriceTemplate[]
    storageTemplate: import('../data/feeTemplates').StorageRentTemplate | null
    regionDispatchRules: import('../data/feeTemplates').RegionDispatchRule[]
  }
  paymentMethods: import('../data/feeTemplates').PaymentMethod[]
  purchases: import('../data/inventoryStore').CatalogPurchase[]
}
