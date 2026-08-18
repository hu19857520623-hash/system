import {
  decryptStoreApiKey,
  encryptStoreApiKey,
  isEncryptedStoreApiKey,
  maskStoreApiKey,
} from './store-api-key.crypto'

describe('store API key crypto', () => {
  const secret = 'unit-test-store-api-key-secret-32chars'

  it('round-trips plaintext and keeps a versioned prefix', () => {
    const encrypted = encryptStoreApiKey('takealot-live-key-value', secret)
    expect(isEncryptedStoreApiKey(encrypted)).toBe(true)
    expect(decryptStoreApiKey(encrypted, secret)).toBe('takealot-live-key-value')
  })

  it('passes through legacy plaintext keys', () => {
    expect(decryptStoreApiKey('legacy-plain-key', secret)).toBe('legacy-plain-key')
  })

  it('masks only the decrypted value', () => {
    expect(maskStoreApiKey('abcdxxxxxxxxwxyz')).toBe('abcd****wxyz')
  })
})
