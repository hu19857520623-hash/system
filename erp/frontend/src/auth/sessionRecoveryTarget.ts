import { internalRedirect } from './internalRedirect'

let current: { token: string; path: string } | null = null

/** The latest navigation owns the return target while its guards are pending. */
export function beginSessionRecoveryTarget(path: string, token: string) {
  const intent = { token, path: internalRedirect(path) }
  current = intent
  return () => { if (current === intent) current = null }
}

export function sessionRecoveryTarget(requestToken: string) {
  return current?.token === requestToken ? current.path : ''
}
