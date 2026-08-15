import { beforeEach, describe, expect, it } from 'vitest'
import { clearAccessToken, getAccessToken, setAccessToken } from './tokenStore'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('tokenStore', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true })
    Object.defineProperty(globalThis, 'sessionStorage', { value: new MemoryStorage(), configurable: true })
  })

  it('stores access tokens only for the current browser session', () => {
    setAccessToken('session-token')
    expect(sessionStorage.getItem('token')).toBe('session-token')
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('migrates and removes a legacy persistent token', () => {
    localStorage.setItem('token', 'legacy-token')
    expect(getAccessToken()).toBe('legacy-token')
    expect(sessionStorage.getItem('token')).toBe('legacy-token')
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('clears both current and legacy token stores', () => {
    sessionStorage.setItem('token', 'current')
    localStorage.setItem('token', 'legacy')
    clearAccessToken()
    expect(getAccessToken()).toBe('')
  })
})
