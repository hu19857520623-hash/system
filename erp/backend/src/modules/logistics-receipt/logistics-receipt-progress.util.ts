import { receiptRequestMetadata } from './logistics-receipt-request.util'

type PoLine = { id: bigint; productId: bigint; sku: string; quantity: number; receivedQty: number | null }
type Receipt = { remark: string | null; items: { productId: bigint; sku: string; actualQty: number; damagedQty?: number }[] }

/** Includes damaged deliveries without counting them as usable warehouse stock. */
export function logisticsReceiptProgress<T extends PoLine>(lines: T[], receipts: Receipt[]) {
  const totals = new Map(lines.map(line => [String(line.id), { goodQty: 0, damagedQty: 0 }]))
  const issues = new Set<string>()
  for (const receipt of receipts) {
    const metadata = receiptRequestMetadata(receipt.remark)
    for (const [index, item] of receipt.items.entries()) {
      const matching = metadata
        ? lines.filter(line => Number(line.id) === metadata.request.items[index]?.poItemId && line.productId === item.productId && line.sku === item.sku)
        : lines.filter(line => line.productId === item.productId && line.sku === item.sku)
      if (matching.length !== 1) { issues.add('历史收货明细无法唯一对应采购明细，请联系主管核对'); continue }
      const actual = Number(item.actualQty), damaged = Number(item.damagedQty ?? 0)
      if (![actual, damaged].every(qty => Number.isSafeInteger(qty) && qty >= 0)) { issues.add('历史收货数量异常，请联系主管核对'); continue }
      const total = totals.get(String(matching[0].id))!
      total.goodQty += actual; total.damagedQty += damaged
    }
  }
  const items = lines.map(line => {
    const totalsForLine = totals.get(String(line.id))!
    const receivedQty = Math.max(line.receivedQty ?? 0, totalsForLine.goodQty + totalsForLine.damagedQty)
    if (receivedQty > line.quantity) issues.add('历史累计收货超过采购数量，请联系主管核对')
    return { ...line, ...totalsForLine, receivedQty, pendingQty: Math.max(0, line.quantity - receivedQty) }
  })
  return { items, issues: [...issues], allReceived: items.length > 0 && items.every(item => item.pendingQty === 0) }
}
