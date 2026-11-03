import { createRenderer, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useReturnList } from './useReturnList'

const listApi = vi.hoisted(() => vi.fn())
vi.mock('@/api/client.js', () => ({ returnsApi: { list: listApi } }))
vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn() } }))

function deferred() {
  let resolve!: (value: { items: { id: number }[]; total: number }) => void
  let reject!: (error: Error) => void
  const promise = new Promise<{ items: { id: number }[]; total: number }>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const stops: (() => void)[] = []
function mountList(scope: () => string | null = () => 'actor7:return.view') {
  let list!: ReturnType<typeof useReturnList>
  // Mount Vue lifecycle hooks without a browser; this is not GUI acceptance.
  const renderer = createRenderer<any, any>({
    createComment: () => ({}), createElement: () => ({}), createText: () => ({}),
    insert: () => {}, remove: () => {}, parentNode: () => null, nextSibling: () => null,
    patchProp: () => {}, setText: () => {}, setElementText: () => {},
  })
  const app = renderer.createApp({ setup() { list = useReturnList(scope); return () => null } })
  app.mount({})
  stops.push(() => app.unmount())
  return list
}
async function flush() { await Promise.resolve(); await nextTick(); await Promise.resolve() }
afterEach(() => { for (const stop of stops.splice(0)) stop(); listApi.mockReset() })

describe('return list request ownership', () => {
  it('keeps a newer filter result when an older request finishes later', async () => {
    const old = deferred(), current = deferred()
    listApi.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const list = mountList()
    await flush()
    list.setStatusFilter('received')
    await flush()
    current.resolve({ items: [{ id: 2 }], total: 1 })
    await flush()
    expect(list.rows.value).toEqual([{ id: 2 }])
    old.resolve({ items: [{ id: 1 }], total: 99 })
    await flush()
    expect(list.rows.value).toEqual([{ id: 2 }])
    expect(list.listTotal.value).toBe(1)
  })

  it('clears old results and selection on a failed query, keeps its filters and allows a read-only retry', async () => {
    listApi.mockResolvedValueOnce({ items: [{ id: 1 }], total: 1 })
      .mockRejectedValueOnce(Error('SQLSTATE ECONNRESET private-path'))
      .mockResolvedValueOnce({ items: [{ id: 2 }], total: 1 })
    const list = mountList()
    await flush()
    list.selectedIds.value = [1]
    list.customerCode.value = ' TKL9069 '
    list.codeValue.value = ' RT-18 '
    list.search()
    expect(list.rows.value).toEqual([])
    expect(list.selectedIds.value).toEqual([])
    expect(list.listTotal.value).toBe(0)
    await flush()
    expect(list.loadError.value).toContain('退件列表加载失败')
    expect(list.loadError.value).not.toMatch(/SQLSTATE|private-path|ECONNRESET/)
    expect(list.loading.value).toBe(false)
    const query = listApi.mock.calls[1]?.[0]
    expect(query).toMatchObject({ customerCode: 'TKL9069', returnNo: 'RT-18', page: 1 })
    await expect(list.loadList()).resolves.toBe(true)
    expect(listApi.mock.calls[2]?.[0]).toEqual(query)
    expect(list.rows.value).toEqual([{ id: 2 }])
    expect(list.loadError.value).toBe('')
  })

  it('does not let an old failure clear a newer loading state or display an irrelevant error', async () => {
    const old = deferred(), current = deferred()
    listApi.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const list = mountList()
    await flush()
    list.setStatusFilter('measured')
    await flush()
    old.reject(Error('old request failed'))
    await flush()
    expect(list.loading.value).toBe(true)
    expect(list.loadError.value).toBe('')
    current.resolve({ items: [{ id: 2 }], total: 1 })
    await flush()
    expect(list.loading.value).toBe(false)
    expect(list.rows.value).toEqual([{ id: 2 }])
  })

  it('clears scope immediately on permission loss, ignores the old response and loads only the restored scope', async () => {
    const old = deferred(), identity = ref<string | null>('actor7:return.view')
    listApi.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ items: [{ id: 8 }], total: 1 })
    const list = mountList(() => identity.value)
    await flush()
    identity.value = null
    expect(list.rows.value).toEqual([])
    await flush()
    expect(listApi).toHaveBeenCalledTimes(1)
    expect(list.loadError.value).toContain('核对登录和查看权限')
    old.resolve({ items: [{ id: 7 }], total: 1 })
    await flush()
    expect(list.rows.value).toEqual([])
    identity.value = 'actor8:return.view'
    await flush()
    expect(listApi).toHaveBeenCalledTimes(2)
    expect(list.rows.value).toEqual([{ id: 8 }])
    expect(list.loadError.value).toBe('')
  })

  it('rechecks a changed storage session before applying a response even without reactive state changes', async () => {
    const pending = deferred()
    let identity = 'session7'
    listApi.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ items: [{ id: 8 }], total: 1 })
    const list = mountList(() => identity)
    await flush()
    identity = 'session8'
    pending.resolve({ items: [{ id: 7 }], total: 1 })
    await flush()
    expect(list.rows.value).toEqual([])
    expect(list.loading.value).toBe(false)
    expect(list.loadError.value).toContain('当前账号重新查询')
    await expect(list.loadList()).resolves.toBe(true)
    expect(list.rows.value).toEqual([{ id: 8 }])
  })

  it.each([true, false])('does not apply a %s-success response after unmount or send a later retry', async success => {
    const pending = deferred()
    listApi.mockReturnValueOnce(pending.promise)
    const list = mountList()
    await flush()
    stops.pop()!()
    if (success) pending.resolve({ items: [{ id: 1 }], total: 1 })
    else pending.reject(Error('disposed request failed'))
    await flush()
    expect(list.rows.value).toEqual([])
    expect(list.loading.value).toBe(false)
    expect(list.loadError.value).toBe('')
    await expect(list.loadList()).resolves.toBe(false)
    expect(listApi).toHaveBeenCalledTimes(1)
  })

  it('combines page, status and explicit search/reset changes into one latest query per tick', async () => {
    listApi.mockResolvedValue({ items: [], total: 0 })
    const list = mountList()
    await flush()
    list.page.value = 3
    list.setStatusFilter('measured')
    list.customerCode.value = 'TKL9069'
    list.search()
    await flush()
    expect(listApi).toHaveBeenCalledTimes(2)
    expect(listApi.mock.calls[1]?.[0]).toMatchObject({ page: 1, status: 'measured', customerCode: 'TKL9069' })
    list.resetFilters()
    await flush()
    expect(listApi).toHaveBeenCalledTimes(3)
    expect(listApi.mock.calls[2]?.[0]).toEqual({ page: 1, pageSize: 20 })
  })

  it('never sends a list request while the current login scope is unreadable', async () => {
    const list = mountList(() => { throw Error('Storage unavailable') })
    await flush()
    expect(listApi).not.toHaveBeenCalled()
    expect(list.loadError.value).toContain('核对登录和查看权限')
    await expect(list.loadList()).resolves.toBe(false)
    expect(listApi).not.toHaveBeenCalled()
  })
})
