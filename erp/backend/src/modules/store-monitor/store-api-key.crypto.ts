import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

const PREFIX = 'enc:v1:'

export function resolveStoreApiKeySecret(...candidates: Array<string | undefined | null>) {
  const secret = candidates.map((value) => String(value || '').trim()).find(Boolean)
  if (!secret) {
    throw new Error('STORE_API_KEY_SECRET or JWT_SECRET is required to encrypt store API keys')
  }
  return secret
}

function keyBytes(secret: string) {
  return createHash('sha256').update(secret).digest()
}

export function isEncryptedStoreApiKey(value: string) {
  return value.startsWith(PREFIX)
}

export function encryptStoreApiKey(plain: string, secret: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyBytes(secret), iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64')
}

export function decryptStoreApiKey(stored: string | null | undefined, secret: string): string | null {
  if (!stored) return null
  if (!isEncryptedStoreApiKey(stored)) return stored
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64')
  if (raw.length < 29) throw new Error('encrypted API key is corrupt')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const ciphertext = raw.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(secret), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

export function maskStoreApiKey(plain: string | null | undefined) {
  if (!plain) return ''
  if (plain.length < 8) return '****'
  return `${plain.slice(0, 4)}****${plain.slice(-4)}`
}
