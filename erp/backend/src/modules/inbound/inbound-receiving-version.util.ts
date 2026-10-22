import { createHash } from 'crypto'
export function inboundReceivingVersion(order: any) {
  const items = (order.items || []).map((line: any) => ({ id: String(line.id), sku: line.sku, expectedQty: Number(line.expectedQty), actualQty: line.actualQty == null ? null : Number(line.actualQty),
    putawayQty: Number(line.putawayQty || 0), qcStatus: line.qcStatus || '', qcRemark: line.qcRemark || '' })).sort((a: any, b: any) => a.id.localeCompare(b.id))
  const cartons = (order.cartons || []).map((box: any) => ({ boxCode: box.boxCode, status: box.status })).sort((a: any, b: any) => a.boxCode.localeCompare(b.boxCode))
  return createHash('sha256').update(JSON.stringify({ id: String(order.id), workflowRevision: String(order.workflowRevision ?? '0'), status: order.status, warehouseCode: order.warehouseCode, receivedCartonCount: order.receivedCartonCount ?? null, items, cartons })).digest('hex')
}

export function inboundMeasurementVersion(order: any, products: any[]) {
  const fields = ['lengthCm', 'widthCm', 'heightCm', 'measuredLengthCm', 'measuredWidthCm', 'measuredHeightCm', 'weightKg']
  const rows = products.map(product => ({ id: String(product.id), values: fields.map(field => product[field] == null ? null : Number(product[field])) })).sort((a, b) => a.id.localeCompare(b.id))
  return createHash('sha256').update(JSON.stringify({ receiving: inboundReceivingVersion(order), products: rows })).digest('hex')
}
