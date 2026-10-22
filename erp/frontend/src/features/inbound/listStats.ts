const pendingReceiptStatuses = new Set(['pending_receipt', 'pending_push', 'push_failed', 'pushed', 'arrived', 'receiving', 'exception'])
export function inboundListStats(rows: Array<{ _raw?: { status?: string }; cbm?: string }>) {
  let pendingReceipt = 0, pendingPutaway = 0, completed = 0, cbmTotal = 0, hasCbm = false
  const active = rows.filter(row => row._raw?.status !== 'cancelled')
  for (const row of active) {
    const status = row._raw?.status || ''
    if (status === 'pending_putaway') pendingPutaway++
    if (status === 'completed' || status === 'confirmed') completed++
    if (pendingReceiptStatuses.has(status)) {
      pendingReceipt++
      const cbm = Number(row.cbm)
      if (Number.isFinite(cbm) && cbm > 0) { cbmTotal += cbm; hasCbm = true }
    }
  }
  return { total: active.length, pendingReceipt, pendingPutaway, completed, cbm: hasCbm ? cbmTotal.toFixed(3) : '—' }
}
