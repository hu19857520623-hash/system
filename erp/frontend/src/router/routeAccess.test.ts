import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { routes } from './routes'
import { ACCOUNT_ROUTES, ROUTE_SCREENS, createErpRouteGuard, isRouteAllowed } from './routeAccess'
import { useAppStore } from '../stores/app'
import { setAccessToken } from '../auth/tokenStore'
import { authApi } from '../api/client'

vi.mock('../api/client', () => ({ authApi: { profile: vi.fn(), login: vi.fn() } }))
class MemoryStorage {
  values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}
function account(roleCode: string, permissions?: string[]) {
  const app = useAppStore()
  app.applyAuthUser({ id: 7, username: 'audit_'+roleCode, realName: '权限验收', roleCode, permissions })
  app.authReady = true
  return app
}
function harness(app = account('finance')) {
  const loaded: string[] = []
  function stubs(items: RouteRecordRaw[]): RouteRecordRaw[] {
    return items.map(row => ({ ...row, ...(row.component ? { component: () => { loaded.push(String(row.name || row.path)); return Promise.resolve({ render: () => null }) } } : {}), ...(row.children ? { children: stubs(row.children) } : {}) }) as RouteRecordRaw)
  }
  const router = createRouter({ history: createMemoryHistory(), routes: stubs(routes) })
  router.beforeEach(createErpRouteGuard(() => app))
  return { app, router, loaded }
}
beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage()); vi.stubGlobal('sessionStorage', new MemoryStorage())
  setActivePinia(createPinia()); vi.clearAllMocks()
})
describe('ERP路由与现有岗位菜单范围一致', () => {
  it('每个具名页面都有明确权限或账号公共页规则，新页面遗漏不能默认为开放', () => {
    const visit = (items: RouteRecordRaw[]) => { for (const row of items) { if (row.name) expect(ACCOUNT_ROUTES.has(String(row.name)) || row.name === 'FlowDebug' || String(row.name) in ROUTE_SCREENS, String(row.name)).toBe(true); if (row.children) visit(row.children) } }
    visit(routes)
    expect(isRouteAllowed({ name: 'UnmappedPage' }, account('admin'))).toBe(false)
  })
  it('路由规则引用的菜单权限键必须存在，避免拼写错误落入未知菜单默认分支', () => {
    const app = account('admin')
    for (const screens of Object.values(ROUTE_SCREENS)) for (const screen of typeof screens === 'string' ? [screens] : screens) expect(screen in app.navRouteMap, screen).toBe(true)
  })
  it.each(['admin','ops','ops_manager','purchaser','purchase_manager','finance','viewer','warehouse','warehouse_manager','inbound_clerk','outbound_clerk','returns_clerk','warehouse_reviewer','cs'])('%s 的全部可见菜单入口仍可进入', async role => {
    const h = harness(account(role))
    for (const [screen,path] of Object.entries(h.app.navRouteMap)) {
      if (!h.app.canViewScreen(screen)) continue
      await h.router.push(path)
      expect(h.router.currentRoute.value.name, role+' '+screen+' '+path).not.toBe('AccessDenied')
    }
  })
  it('财务旧链接不加载入库业务组件，显示可恢复页面并可回工作台', async () => {
    const h = harness()
    await h.router.push('/inbound/receipt?inboundId=81')
    expect(h.router.currentRoute.value.name).toBe('AccessDenied')
    expect(h.router.currentRoute.value.query.redirect).toBe('/inbound/receipt?inboundId=81')
    expect(h.loaded).not.toContain('InboundReceipt')
    await h.router.replace('/dashboard'); expect(h.router.currentRoute.value.name).toBe('Dashboard')
    await h.router.push('/billing'); expect(h.router.currentRoute.value.name).toBe('Billing')
  })
  it('仓库岗位保留收货、旧上架别名和出库入口，但不加载财务、用户管理或调试数据', async () => {
    const h = harness(account('warehouse'))
    for (const path of ['/inbound/receipt', '/inbound/putaway', '/outbound/create']) { await h.router.push(path); expect(h.router.currentRoute.value.name).not.toBe('AccessDenied') }
    for (const path of ['/billing', '/user-management', '/flow-debug']) { await h.router.push(path); expect(h.router.currentRoute.value.name).toBe('AccessDenied') }
    for (const name of ['Billing', 'Permissions', 'FlowDebug']) expect(h.loaded).not.toContain(name)
  })
  it('有入库查看和上架权限的自定义岗位不要求额外的到仓扫描权限', async () => {
    const h = harness(account('warehouse', ['inbound.view', 'inbound.putaway']))
    expect(h.app.canViewScreen('inbound_arrival')).toBe(false)
    await h.router.push('/inbound/putaway?inboundId=81')
    expect(h.router.currentRoute.value.name).toBe('InboundArrivalScan')
    expect(h.router.currentRoute.value.query.step).toBe('putaway')
    expect(h.router.currentRoute.value.query.inboundId).toBe('81')
  })
  it('无财务页签权限时不加载账本组件，有单个页签权限时交给账本页按原规则选择', async () => {
    const h = harness(account('viewer', ['products.view']))
    await h.router.push('/cost'); expect(h.router.currentRoute.value.name).toBe('AccessDenied'); expect(h.loaded).not.toContain('FinanceBooks')
    h.app.applyAuthUser({ id: 7, username: 'custom', realName: '验收', roleCode: 'viewer', permissions: ['cost.view'] })
    await h.router.push('/finance-books/purchase'); expect(h.router.currentRoute.value.name).toBe('FinanceBooks')
  })
  it('管理员可进入调试页，普通账号个人设置与不存在页面有自己的返回入口', async () => {
    const h = harness(account('admin')); await h.router.push('/flow-debug'); expect(h.router.currentRoute.value.name).toBe('FlowDebug')
    account('viewer', ['products.view']); await h.router.push('/settings/profile'); expect(h.router.currentRoute.value.name).toBe('ProfileSettings')
    await h.router.push('/unknown-old-page'); expect(h.router.currentRoute.value.name).toBe('NotFound')
  })
  it('未登录先校验会话并保留合法原路径，已登录不能再次进入登录页', async () => {
    const h = harness(); h.app.logout(); h.app.authReady = false
    const init = vi.spyOn(h.app, 'initAuth')
    await h.router.push('/billing?month=2026-10'); expect(h.router.currentRoute.value.name).toBe('Login'); expect(h.router.currentRoute.value.query.redirect).toBe('/billing?month=2026-10'); expect(init).toHaveBeenCalled()
    account('finance'); await h.router.push('/login'); expect(h.router.currentRoute.value.name).toBe('Dashboard')
  })
  it('重新核对权限使用最新档案，旧账号的延迟返回不能覆盖新账号', async () => {
    const h = harness(); setAccessToken('original')
    vi.mocked(authApi.profile).mockResolvedValueOnce({ id: 7, username: 'original', realName: '验收', roleCode: 'finance', permissions: ['billing.view', 'inbound.view'] })
    await h.app.refreshProfile(); await h.router.push('/inbound/receipt'); expect(h.router.currentRoute.value.name).toBe('InboundReceipt')
    let resolve!: (row: any) => void
    vi.mocked(authApi.profile).mockReturnValueOnce(new Promise(r => { resolve = r }))
    const late = h.app.refreshProfile(); setAccessToken('different'); h.app.applyAuthUser({ id: 8, username: 'new', realName: '当前账号', roleCode: 'viewer' })
    resolve({ id: 7, username: 'old', realName: '旧账号', roleCode: 'admin' })
    await expect(late).rejects.toThrow('登录账号已变化'); expect(h.app.authenticatedUser?.id).toBe(8); expect(h.app.authenticatedUser?.roleCode).toBe('viewer')
  })
})
