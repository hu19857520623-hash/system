export const MANUAL_ARRIVAL_STATUSES = ['pending_receipt', 'pending_push', 'push_failed', 'pushed']

type ReceiveApi = {
  detail: (id: number) => Promise<any>
  arrivalScan: (data: { scanCode: string; warehouseCode: string }) => Promise<any>
  recordReceivedCartonCount: (id: number, data: Record<string, unknown>) => Promise<any>
}

export async function receiveInboundManually(
  api: ReceiveApi, id: number,
  input: { count: number | null; differenceReason: string; clientRequestId: string },
) {
  const count = Number(input.count)
  if (!Number.isSafeInteger(count) || count <= 0 || count > 9999) throw new Error('实收箱数须为 1–9999 的整数')
  const order = await api.detail(id)
  if (order.readOnly || ![...MANUAL_ARRIVAL_STATUSES, 'arrived', 'receiving'].includes(order.status)) {
    throw new Error('当前单据不可手动收货，请刷新列表查看状态')
  }
  const cartons = order.cartons || []
  const scanned = cartons.filter((carton: any) => carton.status === 'received').length
  if (count < scanned) throw new Error(`已扫码确认 ${scanned} 箱，实收箱数不能改小`)
  const reason = input.differenceReason.trim()
  if (cartons.length > 0 && count !== cartons.length && reason.length < 2) {
    throw new Error(`实收 ${count} 箱与应收 ${cartons.length} 箱不一致，请填写差异原因`)
  }
  if (MANUAL_ARRIVAL_STATUSES.includes(order.status)) {
    await api.arrivalScan({ scanCode: order.inboundNo, warehouseCode: order.warehouseCode })
  }
  return api.recordReceivedCartonCount(id, {
    receivedCartonCount: count, differenceReason: reason || undefined, clientRequestId: input.clientRequestId,
  })
}
