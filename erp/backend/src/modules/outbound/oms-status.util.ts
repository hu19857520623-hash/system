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
    case 'cancelled':
      return 'cancelled'
    case 'exception':
      return 'exception'
    default:
      return status
  }
}
