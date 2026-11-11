import assert from 'node:assert/strict'
import test from 'node:test'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import Catalog from './Catalog'
import { RoleProvider } from '../auth/RoleContext'
import { storeAuthSession, type AuthSession } from '../api/client'

test('catalog sync failure stays visible and can be retried', async () => {
  const originals = ['window', 'document', 'localStorage', 'sessionStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  const storage = () => { const rows = new Map<string, string>(); return { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => rows.set(key, value), removeItem: (key: string) => rows.delete(key) } }
  const scheduled: Array<() => void> = []
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(new EventTarget(), { setTimeout: (fn: () => void) => { scheduled.push(fn); return scheduled.length }, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {} }) })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: Object.assign(new EventTarget(), { visibilityState: 'visible' }) })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage() })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage() })
  const session = { token: 'catalog-test', user: { id: 'catalog-tester', username: 'catalog-tester', name: '货盘测试', email: '', role: 'hybrid', status: 'active', customerId: 'c1', customerCode: 'TKL9001', permissions: ['catalog:read', 'catalog:write', 'billing:read'], mustChangePassword: false } } as AuthSession
  storeAuthSession(session)
  const previousFetch = globalThis.fetch
  globalThis.fetch = async input => {
    const url = String(input)
    if (url.endsWith('/auth/me')) return Response.json({ user: session.user })
    if (url.includes('/erp/catalog')) return new Response('upstream failed', { status: 502 })
    if (url.includes('/erp/balance')) return Response.json({ balance: 0 })
    return new Response('not found', { status: 404 })
  }
  let renderer: ReactTestRenderer | undefined
  try {
    await act(async () => { renderer = create(<RoleProvider><Catalog /></RoleProvider>) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const text = JSON.stringify(renderer!.toJSON())
    assert.match(text, /货盘同步失败/)
    assert.match(text, /重新同步/)
    await act(async () => { scheduled.forEach(fn => fn()) })
    const afterTimers = JSON.stringify(renderer!.toJSON())
    assert.match(afterTimers, /货盘同步失败/)
    assert.doesNotMatch(afterTimers, /暂无已同步的货盘商品/)
  } finally {
    await act(async () => { renderer?.unmount() })
    globalThis.fetch = previousFetch
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete (globalThis as Record<string, unknown>)[key]
    }
  }
})
