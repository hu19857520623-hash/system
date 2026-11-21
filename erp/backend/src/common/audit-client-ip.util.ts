import { isIP } from 'node:net'

/** The public ERP proxy overwrites the forwarded address before it reaches the API. */
export function auditClientIp(forwardedIp?: string, peerIp?: string) {
  for (const value of [forwardedIp, peerIp]) {
    const ip = value?.trim().replace(/^::ffff:/i, '')
    if (ip && isIP(ip)) return ip
  }
  return undefined
}
