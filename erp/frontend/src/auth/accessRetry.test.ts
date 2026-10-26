import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createAccessRetry } from './accessRetry'

async function fixture() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/access-denied', name: 'AccessDenied', component: {} },
    { path: '/customer-recharge', name: 'CustomerRecharge', component: {} },
    { path: '/dashboard', name: 'Dashboard', component: {} },
  ] })
  await router.push({ name: 'AccessDenied', query: { reason: 'permission-read-failed', redirect: '/customer-recharge?customer=TKL9001#details' } })
  let token = 'original'
  const app = {
    authenticatedUser: null as { roleCode: string } | null,
    canViewScreen: vi.fn(() => true),
    refreshProfile: vi.fn(async (): Promise<boolean> => { app.authenticatedUser = { roleCode: 'finance' }; return true }),
  }
  const recovery = createAccessRetry(router, app, () => token)
  return { router, app, recovery, changeSession: () => { token = 'new' } }
}

describe('未核对身份的页面恢复', () => {
  it('初次身份读取失败后重新核对成功，可从空身份继续原页面及查询和锚点', async () => {
    const { router, app, recovery } = await fixture()
    await recovery.retry()
    expect(app.authenticatedUser?.roleCode).toBe('finance')
    expect(router.currentRoute.value.fullPath).toBe('/customer-recharge?customer=TKL9001#details')
    expect(recovery.checking.value).toBe(false)
  })
  it('读取失败后保留重试入口，不误报没有访问权限', async () => {
    const { router, app, recovery } = await fixture()
    app.refreshProfile.mockRejectedValue(new TypeError('Failed to fetch'))
    await recovery.retry()
    expect(router.currentRoute.value.query.reason).toBe('permission-read-failed')
    expect(recovery.feedback.value).toContain('权限信息未能读取')
    expect(recovery.feedback.value).not.toContain('Failed to fetch')
    app.refreshProfile.mockResolvedValue(true)
    await recovery.retry()
    expect(router.currentRoute.value.name).toBe('CustomerRecharge')
  })
  it('真实拒绝替换未核对状态并保留原目标', async () => {
    const { router, app, recovery } = await fixture()
    app.canViewScreen.mockReturnValue(false)
    await recovery.retry()
    expect(router.currentRoute.value.name).toBe('AccessDenied')
    expect(router.currentRoute.value.query.reason).toBeUndefined()
    expect(router.currentRoute.value.query.redirect).toBe('/customer-recharge?customer=TKL9001#details')
    expect(recovery.feedback.value).toContain('仍无法访问')
  })
  it.each(['session', 'page', 'unmount'] as const)('延迟返回不会覆盖已变化的 %s', async change => {
    const { router, app, recovery, changeSession } = await fixture()
    let resolve!: (value: boolean) => void
    app.refreshProfile.mockReturnValue(new Promise(r => { resolve = r }))
    const pending = recovery.retry()
    if (change === 'session') changeSession()
    if (change === 'page') await router.push('/dashboard')
    if (change === 'unmount') recovery.stop()
    const before = router.currentRoute.value.fullPath
    resolve(true); await pending
    expect(router.currentRoute.value.fullPath).toBe(before)
    expect(recovery.feedback.value).toBe('')
  })
  it('快速重复点击只读取一次；被新请求替代时明确提供重试提示', async () => {
    const { app, recovery } = await fixture()
    let resolve!: (value: boolean) => void
    app.refreshProfile.mockReturnValue(new Promise(r => { resolve = r }))
    const first = recovery.retry(); await recovery.retry()
    expect(app.refreshProfile).toHaveBeenCalledTimes(1)
    resolve(false); await first
    expect(recovery.feedback.value).toContain('重新核对')
  })
})
