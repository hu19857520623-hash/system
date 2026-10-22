export async function inboundCartonReadiness(db: { operationLog: { findFirst: (...args: any[]) => Promise<any> } }, order: any) {
  const expected = order.cartons?.length || 0, confirmed = Number(order.receivedCartonCount || 0)
  if (confirmed <= 0) return { ready: false, message: '请先确认实收箱数，再进入清点与测量' }
  if (!expected || confirmed === expected) return { ready: true, message: '' }
  const record = await db.operationLog.findFirst({ where: { module: 'inbound', action: { in: ['receive_carton_count', 'reduce_carton'] }, targetId: order.inboundNo }, orderBy: { id: 'desc' } })
  if (record?.action === 'reduce_carton') return { ready: false, message: '箱数已减少，请重新确认实际箱数和差异原因后继续清点' }
  const detail = record?.detail || {}, request = detail.request || detail
  const accepted = Number(request.receivedCartonCount) === confirmed && String(request.differenceReason || '').trim().length >= 2
  return accepted ? { ready: true, message: '' } : { ready: false, message: '外箱尚未扫齐；短收或多收请先登记实际箱数和差异原因，再进入清点' }
}
