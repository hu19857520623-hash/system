import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, inboundApi } from './client.js'

describe('ERP request, download and print Chinese error feedback', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', { getItem: vi.fn(() => ''), removeItem: vi.fn() })
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => ''), removeItem: vi.fn() })
    vi.stubGlobal('window', { location: { pathname: '/login', href: '' } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    [api.get, '/test', 403, 'Forbidden', '没有权限'],
    [api.get, '/test', 500, 'Internal Server Error', '服务处理失败'],
    [inboundApi.downloadSkuLabel, 1, 404, 'Not Found', '未找到'],
    [inboundApi.downloadReceivingList, 1, 502, 'Bad Gateway', '服务暂时无法连接'],
  ])('shows a Chinese failure for an unsuccessful API response', async (call, value, status, raw, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ message: raw }) }))
    await expect(call(value)).rejects.toThrow(String(expected))
  })

  it('uses Chinese feedback for failed network connections and invalid success responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(api.get('/test')).rejects.toThrow('暂时无法连接服务')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <') } }))
    await expect(api.get('/test')).rejects.toThrow('数据处理失败')
  })

  it('keeps business feedback readable and preserves session expiry handling', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'SKU A-01 可用 2 件，不足发运 9 件' }) }))
    await expect(api.get('/test')).rejects.toThrow('SKU A-01 可用 2 件，不足发运 9 件')
    await expect(api.get('/test')).rejects.toMatchObject({ status: 400 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) }))
    await expect(api.get('/test')).rejects.toThrow('登录已失效')
    expect(sessionStorage.removeItem).toHaveBeenCalledWith('token')
  })
  it('会话401带原单据查询和步骤返回登录，HTTP成功包裹的401也统一处理',async()=>{
    vi.stubGlobal('window',{location:{pathname:'/inbound/arrival-scan',search:'?inboundId=81&step=putaway',hash:'#result',href:''}})
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:401,json:async()=>({message:'Unauthorized'})}))
    await expect(api.get('/inbound/81')).rejects.toMatchObject({status:401})
    expect(window.location.href).toBe('/login?reason=session-expired&redirect='+encodeURIComponent('/inbound/arrival-scan?inboundId=81&step=putaway#result'))
    window.location.href=''
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({code:401,message:'Unauthorized'})}))
    await expect(api.get('/inbound/81')).rejects.toMatchObject({status:401})
    expect(window.location.href).toContain('reason=session-expired&redirect=')
  })
  it.each([[api.get,'/inbound/81'],[inboundApi.downloadSkuLabel,81],[inboundApi.downloadReceivingList,81]])('旧请求延迟401不清掉新登录会话 %s',async(call,value)=>{
    let current='old-session',resolve!: (value:unknown)=>void
    vi.stubGlobal('sessionStorage',{getItem:vi.fn(()=>current),removeItem:vi.fn()})
    vi.stubGlobal('window',{location:{pathname:'/billing',search:'',hash:'',href:''}})
    vi.stubGlobal('fetch',vi.fn().mockReturnValue(new Promise(r=>{resolve=r})))
    const pending=(call as any)(value)
    current='new-session';resolve({ok:false,status:401,json:async()=>({message:'Unauthorized'})})
    await expect(pending).rejects.toThrow('原登录请求已失效')
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();expect(window.location.href).toBe('')
  })
  it('店铺监控自己的401不退出ERP，业务查询参数不能绕过ERP会话失效处理',async()=>{
    vi.stubGlobal('window',{location:{pathname:'/billing',href:''}})
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:401,json:async()=>({message:'Unauthorized'})}))
    await expect(api.get('/store-monitor/session')).rejects.toThrow()
    expect(sessionStorage.removeItem).not.toHaveBeenCalled()
    await expect(api.get('/inbound?keyword=/store-monitor')).rejects.toThrow()
    expect(sessionStorage.removeItem).toHaveBeenCalledWith('token');expect(window.location.href).toContain('reason=session-expired&redirect=')
  })

  it.each(['reduceQc', 'reduceCarton', 'reducePutaway'] as const)('sends %s with the original version, reason and quantity', async method => {
    const payload = { clientRequestId: 'original-request', expectedVersion: 'original-version', reason: '实际复核', quantity: 1, expectedCurrent: 2, inboundItemId: 11 }
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { duplicate: false } }) })
    vi.stubGlobal('fetch', request)
    await inboundApi[method](81, payload)
    const [url, options] = request.mock.calls[0]!
    const endpoint = { reduceQc: 'reduce-qc', reduceCarton: 'reduce-carton', reducePutaway: 'reduce-putaway' }[method]
    expect(url).toBe(`/api/inbound/81/${endpoint}`)
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual(payload)
  })
})
