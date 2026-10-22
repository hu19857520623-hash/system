/** A later mutation invalidates an old form even when quantities return to the same values. */
export async function attachInboundWorkflowRevision(db: { operationLog: { findFirst: (...args: any[]) => Promise<any> } }, order: any) {
  const latest = await db.operationLog.findFirst({ where: { module: 'inbound', targetId: order.inboundNo }, orderBy: { id: 'desc' }, select: { id: true } })
  order.workflowRevision = latest?.id != null ? String(latest.id) : '0'
  return order
}
export const INBOUND_WAREHOUSE_ACTIONS = ['receive_carton_count', 'receive_carton', 'receive_carton_check', 'scan_qc', 'qc', 'qc_measure', 'measure_inbound', 'putaway', 'resolve_exception', 'reopen_count', 'close_zero_receipt', 'reduce_qc', 'reduce_carton', 'reduce_putaway']
