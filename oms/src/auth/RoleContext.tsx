import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  type OmsRole,
  type Permission,
  ROLE_LABELS,
  can,
  canAccessRoute,
} from './permissions'
import type { CustomerAccount } from '../data/mockData'
import {
  getAccountsSnapshot,
  persistAccount,
  subscribeAccounts,
} from './accountStore'
import {
  apiGet,
  apiPost,
  getStoredAuthSession,
  isPersistentAuthSession,
  normalizeAuthSession,
  normalizeSessionUser,
  storeAuthSession,
  type AuthSession,
  type SessionUser,
} from '../api/client'

interface RoleContextValue {
  role: OmsRole
  roleLabel: string
  permissions: Permission[]
  isLoggedIn: boolean
  user: SessionUser | null
  userId: string
  userEmail: string
  userName: string
  customerId: string | null
  customerCode: string
  customerType: import('./permissions').CustomerAccountType | null
  warehouse: string
  mustChangePassword: boolean
  authReady: boolean
  authToken: string
  login: (email: string, password: string, remember?: boolean) => Promise<SessionUser>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  logout: () => Promise<void>
  can: (permission: Permission) => boolean
  canAccessRoute: (pathname: string) => boolean
  accounts: CustomerAccount[]
  updateAccount: (id: string, patch: Partial<CustomerAccount>) => void
  toggleAccountStatus: (id: string) => void
}

const RoleContext = createContext<RoleContextValue | null>(null)

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(getStoredAuthSession)
  const [authReady, setAuthReady] = useState(!session)
  const accounts = useSyncExternalStore(subscribeAccounts, getAccountsSnapshot, getAccountsSnapshot)
  const role: OmsRole = session?.user.role ?? 'ecommerce'
  const permissions = session?.user.permissions ?? []

  const clearSession = useCallback(() => {
    storeAuthSession(null)
    setSession(null)
    setAuthReady(true)
  }, [])

  const logout = useCallback(() => {
    const request = getStoredAuthSession()
      ? apiPost<void>('/auth/logout', {}).catch(() => undefined)
      : Promise.resolve()
    clearSession()
    return request
  }, [clearSession])

  useEffect(() => {
    const handleUnauthorized = () => clearSession()
    window.addEventListener('oms:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('oms:unauthorized', handleUnauthorized)
  }, [clearSession])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    apiGet<unknown>('/auth/me')
      .then(response => {
        if (cancelled) return
        const record = response && typeof response === 'object'
          ? response as Record<string, unknown>
          : null
        const user = normalizeSessionUser(record?.user ?? response)
        const next = { token: session.token, user }
        storeAuthSession(next, isPersistentAuthSession())
        setSession(next)
      })
      .catch(() => {
        if (!cancelled) clearSession()
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true)
      })
    return () => { cancelled = true }
  }, [])

  const login = useCallback(async (email: string, password: string, remember = true) => {
    const response = await apiPost<unknown>('/auth/login', { email, password, remember })
    const next = normalizeAuthSession(response)
    storeAuthSession(next, remember)
    setSession(next)
    setAuthReady(true)
    return next.user
  }, [])

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    if (!session) throw new Error('登录状态已失效，请重新登录')
    const remember = isPersistentAuthSession()
    const response = await apiPost<unknown>('/auth/change-password', {
      currentPassword,
      newPassword,
    })

    let next: AuthSession
    try {
      next = normalizeAuthSession(response, session.token)
    } catch {
      // Some deployments return only { success: true }; refresh the user so
      // mustChangePassword is still cleared from authoritative server state.
      const me = await apiGet<unknown>('/auth/me')
      const record = me && typeof me === 'object' ? me as Record<string, unknown> : null
      next = {
        token: session.token,
        user: normalizeSessionUser(record?.user ?? me),
      }
    }
    storeAuthSession(next, remember)
    setSession(next)
  }, [session])

  const updateAccount = useCallback((id: string, patch: Partial<CustomerAccount>) => {
    void persistAccount(id, patch).catch(error => {
      window.alert(`账号保存失败，数据已恢复：${error instanceof Error ? error.message : String(error)}`)
    })
  }, [])

  const toggleAccountStatus = useCallback((id: string) => {
    const current = getAccountsSnapshot().find(account => account.id === id)
    if (!current) return
    void persistAccount(id, {
      status: current.status === 'active' ? 'disabled' : 'active',
    }).catch(error => {
      window.alert(`账号状态更新失败，数据已恢复：${error instanceof Error ? error.message : String(error)}`)
    })
  }, [])

  const value = useMemo<RoleContextValue>(() => ({
    role,
    roleLabel: ROLE_LABELS[role],
    permissions,
    isLoggedIn: Boolean(session),
    user: session?.user ?? null,
    userId: session?.user.id ?? '',
    userEmail: session?.user.email ?? '',
    userName: session?.user.name ?? '',
    customerId: session?.user.customerId ?? null,
    customerCode: session?.user.customerCode ?? '',
    customerType: session?.user.type ?? null,
    warehouse: session?.user.warehouse ?? '',
    mustChangePassword: Boolean(session?.user.mustChangePassword),
    authReady,
    authToken: session?.token ?? '',
    login,
    changePassword,
    logout,
    can: (permission: Permission) => can(role, permission, permissions),
    canAccessRoute: (pathname: string) => canAccessRoute(role, pathname, permissions),
    accounts,
    updateAccount,
    toggleAccountStatus,
  }), [
    role,
    permissions,
    session,
    authReady,
    login,
    changePassword,
    logout,
    accounts,
    updateAccount,
    toggleAccountStatus,
  ])

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
}

export function useRole() {
  const context = useContext(RoleContext)
  if (!context) throw new Error('useRole must be used within RoleProvider')
  return context
}
