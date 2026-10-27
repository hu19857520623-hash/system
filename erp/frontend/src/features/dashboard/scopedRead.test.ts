import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { useScopedDashboardRead } from './scopedRead'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.restoreAllMocks() })
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture<T>(read: () => Promise<T>, initial: string | null = 'token:manager:permissions') {
  const key = ref(initial), scope = effectScope(); scopes.push(scope)
  const result = scope.run(() => useScopedDashboardRead(() => key.value, read, '工作台'))!
  return { key, scope, ...result }
}
describe('工作台读取结果的会话与权限归属', () => {
  it('无读取权限时不请求，授权后自动读取；重复刷新共用当前请求', async () => {
    const response = deferred<string>(), read = vi.fn(() => response.promise), f = fixture(read, null)
    expect(read).not.toHaveBeenCalled(); f.key.value = 'new-authorized-scope'
    const first = f.refresh(), second = f.refresh(); expect(first).toBe(second); expect(read).toHaveBeenCalledTimes(1)
    response.resolve('当前数据'); await first
    expect(f.data.value).toBe('当前数据'); expect(f.lastRead.value).not.toBe(''); expect(f.loading.value).toBe(false)
  })
  it('同账号撤销权限立刻清除已读私有内容，不保留计划公告或旧待办', async () => {
    const f = fixture(async () => ({ announcement: '未发布', todo: '审核' }))
    await f.refresh(); expect(f.data.value?.announcement).toBe('未发布')
    f.key.value = null
    expect(f.data.value).toBeNull(); expect(f.lastRead.value).toBe(''); expect(f.error.value).toBe(''); expect(f.loading.value).toBe(false)
  })
  it('同用户ID改岗后，新请求不被旧请求阻塞，旧成功不能写回新范围', async () => {
    const old = deferred<string>(), current = deferred<string>(), read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const f = fixture<string>(read), oldRead = f.refresh()
    f.key.value = 'same-user:warehouse:new-permissions'; expect(read).toHaveBeenCalledTimes(2)
    const currentRead = f.refresh(); old.resolve('管理员计划公告'); await oldRead
    expect(f.data.value).toBeNull(); expect(f.loading.value).toBe(true)
    current.resolve('仓库范围'); await currentRead
    expect(f.data.value).toBe('仓库范围'); expect(f.loading.value).toBe(false)
  })
  it('旧失败和旧finally不覆盖当前错误或解除当前加载状态', async () => {
    const old = deferred<string>(), current = deferred<string>(), read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const f = fixture<string>(read), oldRead = f.refresh(); f.key.value = 'other-session'
    old.reject(new Error('Old network failure')); await oldRead
    expect(f.error.value).toBe(''); expect(f.loading.value).toBe(true)
    current.reject(new Error('NetworkError')); await f.refresh()
    expect(f.error.value).toContain('工作台读取未完成'); expect(f.error.value).not.toContain('NetworkError'); expect(f.loading.value).toBe(false)
  })
  it('原范围读取失败保留成功数据并可明确重试，初次失败不冒充已读取', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('Internal Server Error')).mockResolvedValueOnce(7).mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValueOnce(9)
    const f = fixture<number>(read); await f.refresh()
    expect(f.data.value).toBeNull(); expect(f.error.value).toContain('尚未读取数据'); expect(f.lastRead.value).toBe('')
    await f.refresh(); expect(f.data.value).toBe(7)
    await f.refresh(); expect(f.data.value).toBe(7); expect(f.error.value).toContain('保留上次读取'); expect(f.error.value).not.toContain('fetch')
    await f.refresh(); expect(f.data.value).toBe(9); expect(f.error.value).toBe('')
  })
  it('权限先撤销后恢复也不接受第一轮同名范围的迟到响应', async () => {
    const old = deferred<string>(), next = deferred<string>(), read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    const f = fixture<string>(read), first = f.refresh(); const key = f.key.value
    f.key.value = null; f.key.value = key
    const second = f.refresh(); next.resolve('重新授权后的数据'); await second; old.resolve('第一次授权的数据'); await first
    expect(f.data.value).toBe('重新授权后的数据')
  })
  it('组件卸载后不应用成功结果、不记录错误也不重启读取', async () => {
    const response = deferred<string>(), read = vi.fn(() => response.promise), f = fixture(read), pending = f.refresh()
    f.scope.stop(); response.resolve('迟到数据'); await pending; f.key.value = 'new'; await f.refresh()
    expect(read).toHaveBeenCalledTimes(1); expect(f.data.value).toBeNull(); expect(f.lastRead.value).toBe(''); expect(f.error.value).toBe('')
  })
})
