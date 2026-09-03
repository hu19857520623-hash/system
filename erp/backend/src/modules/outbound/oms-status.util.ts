/** ERP 出库状态 → OMS 履约状态。取消与仓内异常分开，避免客户侧把已取消看成异常单。 */
export function toOmsOutboundStatus(status: string): string {
  switch (status) {
    case 'pending_pick':
      return 'locked'
    case 'picking':
    case 'picked':
    case 'reviewing':
    case 'pending_relabel':
    case 'packed':
      return 'picking'
    case 'shipped':
      return 'shipped'
    case 'delivered':
      return 'delivered'
    case 'partial_delivered':
      return 'partial_delivered'
    case 'delivery_failed':
      return 'delivery_failed'
    case 'cancelled':
      return 'cancelled'
    case 'exception':
      return 'exception'
    default:
      return status
  }
}

/** ERP 出库状态 → OMS 物流轨迹状态。派送失败/部分签收独立节点，进入物流异常 Tab。 */
export function toOmsLogisticsStatus(status: string): string {
  if (status === 'delivered') return 'delivered'
  if (status === 'partial_delivered') return 'partial_delivered'
  if (status === 'delivery_failed') return 'delivery_failed'
  if (status === 'exception') return 'exception'
  return 'in_transit'
}

export function isOmsLogisticsExceptionStatus(status?: string | null): boolean {
  return status === 'exception' || status === 'delivery_failed' || status === 'partial_delivered'
}
