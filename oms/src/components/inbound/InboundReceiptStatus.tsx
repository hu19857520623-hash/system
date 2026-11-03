import { Badge } from '../ui'
import { statusLabels, type InboundOrder } from '../../data/mockData'

export function InboundReceiptStatus({ order }: { order: Pick<InboundOrder, 'status' | 'totalQty' | 'receivedQty'> }) {
  const shortage = order.status === 'shelved' ? Math.max(0, order.totalQty - order.receivedQty) : 0
  const label = order.status === 'shelved' && order.receivedQty === 0 && order.totalQty > 0 ? '零收货结束' : statusLabels[order.status]
  return <span className="inline-flex flex-wrap items-center gap-1.5">
    <Badge status={order.status} label={label} />
    {shortage > 0 && <span className="text-xs font-medium text-amber-700">短收 {shortage} 件</span>}
  </span>
}
