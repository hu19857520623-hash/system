import { createHash } from 'crypto'

export type ReturnRequestLog = { action: string; detail: unknown }
export type ReturnRequestDecision = 'proceed' | 'replay' | 'closed' | 'mismatch'

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export function returnRequestFingerprint(value: unknown) {
  return createHash('sha256').update(stable(value)).digest('hex')
}

export function classifyReturnRequest(
  logs: ReturnRequestLog[],
  businessAction: string,
  clientRequestId: string,
  fingerprint: string,
): ReturnRequestDecision {
  const id = clientRequestId.trim()
  if (!id) return 'proceed'
  const detailOf = (log: ReturnRequestLog) => (log.detail && typeof log.detail === 'object' ? log.detail as { clientRequestId?: string; businessAction?: string; requestFingerprint?: string } : null)
  const mine = logs.filter(log => {
    const detail = detailOf(log)
    if (!detail || detail.clientRequestId !== id) return false
    if (log.action === 'return_request_close') return detail.businessAction === businessAction
    return log.action === businessAction
  })
  const business = mine.find(log => log.action === businessAction)
  if (business) return detailOf(business)?.requestFingerprint === fingerprint ? 'replay' : 'mismatch'
  if (mine.some(log => log.action === 'return_request_close')) return 'closed'
  return 'proceed'
}

export function returnRequestRefusal(decision: ReturnRequestDecision, label: string) {
  if (decision === 'mismatch') return `同一次${label}的内容已变化。请结束本次后再重新填写，不要修改后重复提交`
  if (decision === 'closed') return `原${label}已结束。请按结束回执重新填写，不要用同一个请求继续`
  return ''
}
