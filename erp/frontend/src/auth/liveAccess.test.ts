import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router'
import { createLiveAccess } from './liveAccess'
import { notifyPermissionFailure } from './permissionEvents'
import { getAccessToken, setAccessToken } from './tokenStore'
import { useAppStore } from '../stores/app'
import { authApi } from '../api/client'
import { createErpRouteGuard } from '../router/routeAccess'
import { routes } from '../router/routes'

vi.mock('../api/client', () => ({ authApi: { profile: vi.fn(), login: vi.fn() } }))
class MemoryStorage {
  values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}
const finance = { id: 7, username: 'audit_finance', realName: '虚构财务', roleCode: 'finance', permissions: ['budget_credit.view', 'budget_credit.export', 'billing.view'] }
const warehouse = { ...finance, roleCode: 'warehouse', permissions: ['inbound.view', 'outbound.view'] }
const cleanups: (() => void)[] = []
beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); vi.stubGlobal('sessionStorage', new MemoryStorage()); setActivePinia(createPinia()); vi.clearAllMocks(); setAccessToken('current-session') })
afterEach(() => { for (const stop of cleanups.splice(0)) stop(); vi.useRealTimers(); vi.unstubAllGlobals() })
async function fixture(path = '/customer-recharge?customer=TKL9001#details') {
  const app = useAppStore(); app.applyAuthUser(finance); app.authReady = true
  vi.mocked(authApi.profile).mockResolvedValue(finance)
  const loaded: string[] = []
  const stub = (items: RouteRecordRaw[]): RouteRecordRaw[] => items.map(row => ({ ...row,
    ...(row.component ? { component: () => { loaded.push(String(row.name)); return Promise.resolve({ render: () => null }) } } : {}),
    ...(row.children ? { children: stub(row.children) } : {}),
  }) as RouteRecordRaw)
  const router = createRouter({ history: createMemoryHistory(), routes: stub(routes) })
  const access = createLiveAccess(router, () => app, getAccessToken)
  router.beforeEach(createErpRouteGuard(() => app, access.refresh))
  await router.push(path); await nextTick()
  vi.mocked(authApi.profile).mockClear(); loaded.length = 0
  const win = new EventTarget(), doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
  cleanups.push(access.start(win as any, doc as any))
  return { app, router, access, loaded, win, doc }
}

describe('挂载会话当前权限与恢复路径', () => {
  it('同一会话收到连续拒绝只核对一次，菜单按钮撤销后跳到原目标受限页，不重放业务操作', async () => {
    const { app, router, access } = await fixture()
    const replace = vi.spyOn(router, 'replace')
    vi.mocked(authApi.profile).mockResolvedValue(warehouse)
    for (let i = 0; i < 20; i++) notifyPermissionFailure('/async-io/export', 403, true)
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('AccessDenied'))
    expect(authApi.profile).toHaveBeenCalledTimes(1); expect(replace).toHaveBeenCalledTimes(1)
    expect(app.hasPerm('budget_credit.export')).toBe(false)
    expect(app.visibleNav.flatMap(g => g.items).some(i => i.id === 'budget_credit')).toBe(false)
    expect(router.currentRoute.value.query.redirect).toBe('/customer-recharge?customer=TKL9001#details')
    expect(access.notice.value).toContain('权限已更新')
  })
  it('跳转前核对最新岗位，不先加载已撤权组件；新授权也不被旧缓存拦住', async () => {
    const { router, app, loaded } = await fixture('/dashboard')
    vi.mocked(authApi.profile).mockResolvedValue(warehouse)
    await router.push('/billing?month=2026-10#bill')
    expect(router.currentRoute.value.name).toBe('AccessDenied'); expect(loaded).not.toContain('Billing')
    expect(app.authenticatedUser?.roleCode).toBe('warehouse')
    vi.mocked(authApi.profile).mockResolvedValue(finance)
    await router.push('/billing?month=2026-10#bill')
    expect(router.currentRoute.value.name).toBe('Billing'); expect(loaded).toContain('Billing')
  })
  it('业务级拒绝但页面权限仍在时不跳走，不清空原页面状态', async () => {
    const { router, access } = await fixture()
    notifyPermissionFailure('/async-io/8/restart', 403, true)
    await access.refreshCurrent()
    expect(router.currentRoute.value.name).toBe('CustomerRecharge')
    expect(router.currentRoute.value.fullPath).toBe('/customer-recharge?customer=TKL9001#details')
    expect(access.notice.value).toBe(''); expect(access.error.value).toBe('')
  })
  it('只撤销动作权限时保留仍有权访问的页面，按钮立即撤销并显示更新说明', async () => {
    const { router, access, app } = await fixture()
    vi.mocked(authApi.profile).mockResolvedValue({ ...finance, permissions: ['budget_credit.view'] })
    await access.refreshCurrent()
    expect(router.currentRoute.value.name).toBe('CustomerRecharge')
    expect(app.canViewScreen('budget_credit')).toBe(true); expect(app.hasPerm('budget_credit.export')).toBe(false)
    expect(access.notice.value).toContain('权限已更新')
  })
  it('后台页不轮询，回到前台和可见定时检查能更新权限', async () => {
    vi.useFakeTimers()
    const { access, app, doc, win } = await fixture('/dashboard')
    doc.visibilityState = 'hidden'; await vi.advanceTimersByTimeAsync(30_000)
    expect(authApi.profile).not.toHaveBeenCalled()
    doc.visibilityState = 'visible'; vi.mocked(authApi.profile).mockResolvedValue(warehouse)
    win.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0)
    expect(app.authenticatedUser?.roleCode).toBe('warehouse')
    vi.mocked(authApi.profile).mockResolvedValue(finance)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(app.authenticatedUser?.roleCode).toBe('finance'); expect(access.error.value).toBe('')
  })
  it('读取失败保留登录，不冒充无权限；原页面可在核对成功后继续', async () => {
    const { access, router, app } = await fixture()
    vi.mocked(authApi.profile).mockRejectedValueOnce(new Error('Failed to fetch'))
    expect(await access.refreshCurrent()).toBe('failed')
    expect(access.error.value).toContain('网络连接失败'); expect(getAccessToken()).toBe('current-session')
    expect(app.isAuthenticated).toBe(true); expect(router.currentRoute.value.name).toBe('CustomerRecharge')
    vi.mocked(authApi.profile).mockResolvedValue(finance)
    expect(await access.refreshCurrent()).toBe('ready'); expect(access.error.value).toBe('')
  })
  it('跳转读取失败进入未核对页面，而不是断言无权；成功后保留原地址进入', async () => {
    const { router } = await fixture('/dashboard')
    vi.mocked(authApi.profile).mockRejectedValueOnce(new Error('NetworkError'))
    await router.push('/billing?month=2026-10#bill')
    expect(router.currentRoute.value.name).toBe('AccessDenied')
    expect(router.currentRoute.value.query.reason).toBe('permission-read-failed')
    expect(router.currentRoute.value.query.redirect).toBe('/billing?month=2026-10#bill')
    vi.mocked(authApi.profile).mockResolvedValue(finance)
    await router.replace(String(router.currentRoute.value.query.redirect))
    expect(router.currentRoute.value.fullPath).toBe('/billing?month=2026-10#bill')
  })
  it('旧账号迟到失败不覆盖新账号的成功状态，也不让checking提前结束', async () => {
    const { access, app, router } = await fixture('/dashboard')
    let rejectOld!: (e: Error) => void, resolveNew!: (row: any) => void
    vi.mocked(authApi.profile).mockReturnValueOnce(new Promise((_, reject) => { rejectOld = reject }))
    const old = access.refreshCurrent()
    setAccessToken('new-session'); app.applyAuthUser({ ...warehouse, id: 8 })
    vi.mocked(authApi.profile).mockReturnValueOnce(new Promise(resolve => { resolveNew = resolve }))
    const fresh = access.refreshCurrent(); rejectOld(new Error('Synthetic old error'))
    expect(await old).toBe('changed'); expect(access.checking.value).toBe(true); expect(access.error.value).toBe('')
    resolveNew({ ...warehouse, id: 8 }); expect(await fresh).toBe('ready')
    expect(access.checking.value).toBe(false); expect(app.authenticatedUser?.id).toBe(8); expect(router.currentRoute.value.path).toBe('/dashboard')
  })
  it('同账号较旧档案不能覆盖新的权限结果，即使新请求先返回', async () => {
    const { app } = await fixture('/dashboard')
    let resolveOld!: (row: any) => void
    vi.mocked(authApi.profile).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
    const old = app.refreshProfile()
    vi.mocked(authApi.profile).mockResolvedValueOnce(warehouse)
    await app.refreshProfile(); resolveOld({ ...finance, roleCode: 'admin' })
    expect(await old).toBe(false); expect(app.authenticatedUser?.roleCode).toBe('warehouse')
  })
  it('退出后停止监听与定时器，页面卸载不留下后台核对', async () => {
    vi.useFakeTimers()
    const { win } = await fixture('/dashboard')
    for (const stop of cleanups.splice(0)) stop()
    win.dispatchEvent(new Event('focus')); notifyPermissionFailure('/test', 403, true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(authApi.profile).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
})

describe('权限档案与初始化读取边界', () => {
  it('明确空权限、未登录和未知岗位不回退成默认管理权限', () => {
    const app = useAppStore(); expect(app.hasPerm('permissions.manage')).toBe(false)
    app.applyAuthUser({ ...finance, permissions: [] }); expect(app.hasPerm('billing.view')).toBe(false)
    app.applyAuthUser({ ...finance, roleCode: 'legacy_unknown', permissions: undefined }); expect(app.hasPerm('permissions.manage')).toBe(false); expect(app.visibleNav.flatMap(group => group.items.map(item => item.id))).toEqual(['dashboard'])
  })
  it('初始化临时故障保留令牌且没有业务菜单，进入可核对页面', async () => {
    const app = useAppStore(); vi.mocked(authApi.profile).mockRejectedValueOnce(new Error('Failed to fetch'))
    await app.initAuth()
    expect(getAccessToken()).toBe('current-session'); expect(app.authReadError).toContain('网络连接失败'); expect(app.visibleNav.flatMap(group => group.items.map(item => item.id))).toEqual(['dashboard'])
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/billing', name: 'Billing', component: {} }, { path: '/access-denied', name: 'AccessDenied', component: {} }, { path: '/login', name: 'Login', component: {} }] })
    router.beforeEach(createErpRouteGuard(() => app))
    await router.push('/billing?month=2026-10')
    expect(router.currentRoute.value.name).toBe('AccessDenied'); expect(router.currentRoute.value.query.reason).toBe('permission-read-failed')
    vi.mocked(authApi.profile).mockResolvedValueOnce(finance); await app.refreshProfile()
    expect(app.authReadError).toBe(''); expect(app.isAuthenticated).toBe(true)
  })
  it('初始化明确401清除令牌，不能以未核对状态留在系统', async () => {
    const app = useAppStore(); vi.mocked(authApi.profile).mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { status: 401 }))
    await app.initAuth(); expect(getAccessToken()).toBe(''); expect(app.authReadError).toBe(''); expect(app.isAuthenticated).toBe(false)
  })
})
