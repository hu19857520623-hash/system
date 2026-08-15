const TOKEN_KEY = 'token'

export function getAccessToken(): string {
  const token = sessionStorage.getItem(TOKEN_KEY)
  if (token) return token

  // One-time compatibility migration from the former persistent storage.
  const legacyToken = localStorage.getItem(TOKEN_KEY)
  if (!legacyToken) return ''
  sessionStorage.setItem(TOKEN_KEY, legacyToken)
  localStorage.removeItem(TOKEN_KEY)
  return legacyToken
}

export function setAccessToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token)
  localStorage.removeItem(TOKEN_KEY)
}

export function clearAccessToken(): void {
  sessionStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(TOKEN_KEY)
}
