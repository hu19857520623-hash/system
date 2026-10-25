import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPageRecovery, reloadRecoveryPage } from './pageRecovery'
import { safeInternalPath, internalRedirect } from '../auth/internalRedirect'

const disposers: (() => void)[] = []
afterEach(() => { for (const dispose of disposers.splice(0)) dispose() })
async function fixture(initial = '/dashboard') {
  let broken = true, brokenHome = false
  const Page = { render: () => null }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/dashboard', component: () => brokenHome ? Promise.reject(new Error('Synthetic home chunk failure')) : Promise.resolve(Page), meta: { title: '工作台' } },
    { path: '/wms/reports', component: () => broken ? Promise.reject(new Error('Failed to fetch dynamically imported module')) : Promise.resolve(Page), meta: { title: '作业报表' } },
    { path: '/login', component: Page }, { path: '/profile', component: Page },
  ] })
  const open = vi.fn(), recovery = createPageRecovery(router, open)
  disposers.push(recovery.dispose)
  await router.push(initial); await nextTick()
  return { router, open, recovery, restore: () => { broken = false }, breakHome: () => { brokenHome = true } }
}

describe('页面加载/显示错误保留实际目标，按钮可重试与返回', () => {
  it('相同完整地址含锚点时显式刷新，而不只触发同文档导航', () => {
    const location = { href: 'https://erp.invalid/settings/profile?section=contact#details', assign: vi.fn(), reload: vi.fn() }, history = { pushState: vi.fn() }
    reloadRecoveryPage('/settings/profile?section=contact#details', location, history)
    expect(location.reload).toHaveBeenCalledOnce(); expect(location.assign).not.toHaveBeenCalled(); expect(history.pushState).not.toHaveBeenCalled()
  })
  it('同路径的不同锚点先保留目标，再完整刷新', () => {
    const location = { href: 'https://erp.invalid/settings/profile?section=contact#old', assign: vi.fn(), reload: vi.fn() }, history = { pushState: vi.fn() }
    reloadRecoveryPage('/settings/profile?section=contact#details', location, history)
    expect(history.pushState).toHaveBeenCalledWith(null, '', '/settings/profile?section=contact#details')
    expect(location.reload).toHaveBeenCalledOnce(); expect(location.assign).not.toHaveBeenCalled()
  })
  it('不同页面完整导航到目标，保留查询及锚点并且不覆盖原历史记录', () => {
    const location = { href: 'https://erp.invalid/dashboard', assign: vi.fn(), reload: vi.fn() }, history = { pushState: vi.fn() }
    reloadRecoveryPage('/wms/reports?warehouse=JHB#details', location, history)
    expect(location.assign).toHaveBeenCalledWith('https://erp.invalid/wms/reports?warehouse=JHB#details')
    expect(location.reload).not.toHaveBeenCalled(); expect(history.pushState).not.toHaveBeenCalled()
  })
  it('真实懒加载失败后currentRoute仍是上一页，重试必须使用失败目标及完整查询/hash', async () => {
    const { router, recovery, open, restore } = await fixture()
    const target = '/wms/reports?warehouse=JHB&keyword=%E5%BA%8A#details'
    await expect(router.push(target)).rejects.toThrow('Failed to fetch')
    expect(router.currentRoute.value.fullPath).toBe('/dashboard')
    expect(recovery.failed.value).toBe(true); expect(recovery.targetTitle.value).toBe('作业报表')
    recovery.reload(); expect(open).toHaveBeenCalledExactlyOnceWith(target)
    restore(); await router.push(target); await nextTick()
    expect(router.currentRoute.value.fullPath).toBe(target); expect(recovery.failed.value).toBe(false)
  })
  it('返回当前本来就在的工作台也能退出错误页', async () => {
    const { router, recovery } = await fixture()
    await expect(router.push('/wms/reports')).rejects.toThrow()
    await recovery.returnHome()
    expect(router.currentRoute.value.path).toBe('/dashboard'); expect(recovery.failed.value).toBe(false)
  })
  it('渲染异常重试当前页面，公开登录页也能重试，但登录跳转仍防循环', async () => {
    const { router, recovery, open } = await fixture()
    await router.push('/login?redirect=/profile#form'); await nextTick()
    recovery.capture(); recovery.reload()
    expect(open).toHaveBeenLastCalledWith('/login?redirect=/profile#form')
    expect(internalRedirect('/login?redirect=/profile')).toBe('/dashboard')
  })
  it('原生导航调用失败保留中文反馈和两个恢复入口', async () => {
    const { router } = await fixture()
    const recovery = createPageRecovery(router, () => { throw new Error('Synthetic navigation exception') }); disposers.push(recovery.dispose)
    recovery.capture('/profile?section=name#form'); recovery.reload()
    expect(recovery.failed.value).toBe(true); expect(recovery.feedback.value).toContain('页面未能重新打开')
    expect(recovery.feedback.value).not.toContain('Synthetic')
  })
  it('用户守卫阻止返回时不冒充已返回，清除守卫后可继续', async () => {
    const { router, recovery, restore } = await fixture()
    restore(); await router.push('/wms/reports'); await nextTick(); recovery.capture()
    const remove = router.beforeEach(to => to.path === '/dashboard' ? false : undefined)
    await recovery.returnHome()
    expect(recovery.failed.value).toBe(true); expect(recovery.feedback.value).toContain('未能返回')
    remove(); await recovery.returnHome(); expect(router.currentRoute.value.path).toBe('/dashboard'); expect(recovery.failed.value).toBe(false)
  })
  it('工作台本身加载失败时仍给出中文反馈，重试指向工作台', async () => {
    const { recovery, open, breakHome } = await fixture('/profile')
    recovery.capture('/wms/reports'); breakHome(); await recovery.returnHome()
    expect(recovery.failed.value).toBe(true)
    expect(recovery.feedback.value).toContain('工作台暂时也无法打开')
    recovery.reload(); expect(open).toHaveBeenLastCalledWith('/dashboard')
  })
  it('卸载后解除路由监听，不污染新的页面错误状态', async () => {
    const { router, recovery } = await fixture()
    const silence = router.onError(() => undefined); disposers.push(silence)
    recovery.dispose(); await expect(router.push('/wms/reports')).rejects.toThrow()
    expect(recovery.failed.value).toBe(false)
  })
  it.each(['https://example.com','//example.com','/%2f%2fexample.com','/\\example.com','/bad%ZZ','/profile\n',null])('异常恢复目标%s只回内部工作台', path => {
    expect(safeInternalPath(path)).toBe('/dashboard')
  })
})
