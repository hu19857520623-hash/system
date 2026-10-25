import { describe, expect, it } from 'vitest'
import { internalRedirect, sessionReturnPath } from './internalRedirect'

describe('登录和权限恢复跳转', () => {
  it('保留内部单据路径、中文查询和上架步骤', () => {
    for (const path of ['/inbound/receipt?inboundId=81', '/inbound/arrival-scan?inboundId=81&step=putaway', '/pricing?keyword=床头柜#history']) expect(internalRedirect(path)).toBe(path)
  })
  it.each([undefined, null, ['/billing'], '', 'https://example.com', '//example.com', '/\\example.com', '/%2f%2fexample.com', '/bad%ZZ', '/login?redirect=/billing', '/access-denied?redirect=/billing', '/a/../login', '/a/%2e%2e/access-denied', '/%0alogin', '/billing\n', '/'+ 'a'.repeat(4097)])('异常返回地址 %s 回工作台，避免外跳或恢复循环', value => {
    expect(internalRedirect(value)).toBe('/dashboard')
  })
  it('会话失效保留单据、步骤和hash，权限恢复页取原目标而不返回恢复页本身',()=>{
    expect(sessionReturnPath({pathname:'/inbound/arrival-scan',search:'?inboundId=81&step=putaway',hash:'#result'})).toBe('/inbound/arrival-scan?inboundId=81&step=putaway#result')
    expect(sessionReturnPath({pathname:'/access-denied',search:'?redirect=%2Finbound%2Freceipt%3FinboundId%3D81'})).toBe('/inbound/receipt?inboundId=81')
    expect(sessionReturnPath({pathname:'/access-denied',search:'?redirect=https://example.com'})).toBe('/dashboard')
  })
})
