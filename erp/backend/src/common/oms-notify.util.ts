/**
 * 向 OMS 推送履约状态变更（失败不影响 ERP 主流程）。
 * 配置：OMS_WEBHOOK_URL=http://127.0.0.1:3001/api/erp/webhooks/events
 */
import { createHmac, randomUUID } from 'crypto'

export type OmsNotifyEventType =
  | 'inbound.status'
  | 'outbound.status'
  | 'outbound.fees'
  | 'outbound.refund'
  | 'return.status'
  | 'logistics.update'
  | 'inventory.changed'
  | 'billing.changed'
  | 'balance.changed'
  | 'announcement.publish'

export async function notifyOms(
  type: OmsNotifyEventType,
  customerCode: string | null | undefined,
  data: Record<string, unknown>,
): Promise<boolean> {
  const base = String(process.env.OMS_WEBHOOK_URL || '').trim()
  if (!base) return false
  const code = String(customerCode || '').trim()
  // 公告可广播；其余事件必须带客户编码
  if (!code && type !== 'announcement.publish') return false

  const url = base.replace(/\/$/, '')
  const eventId = randomUUID()
  const body = {
    eventId,
    type,
    customerCode: code || '*',
    data,
    at: new Date().toISOString(),
  }
  const serialized = JSON.stringify(body)
  const secret = String(process.env.OMS_WEBHOOK_SECRET || '').trim()
  const signature = secret
    ? `sha256=${createHmac('sha256', secret).update(serialized).digest('hex')}`
    : ''

  let lastError = ''
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-OMS-Event-Id': eventId,
          ...(signature ? { 'X-OMS-Signature': signature } : {}),
        },
        body: serialized,
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) return true
      const text = await res.text().catch(() => '')
      lastError = `${res.status} ${text}`
      if (res.status < 500 && res.status !== 429) break
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
    if (attempt < 4) {
      await new Promise(resolve => setTimeout(resolve, 250 * 2 ** (attempt - 1)))
    }
  }
  console.warn(`[oms-notify] ${type} → ${code} failed after retries: ${lastError}`)
  return false
}
