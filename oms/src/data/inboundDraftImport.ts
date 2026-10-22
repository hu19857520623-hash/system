import type { InboundOrder } from './mockData'
import type { ParsedInboundImport } from './importTemplates'
import { buildInboundNo, inboundNoPrefix, nextSeqFromNos } from './wmsDocNo'

export function buildImportedInboundDrafts(rows: ParsedInboundImport[], options: {
  customerId: string
  customerCode: string
  existingNos: string[]
  date?: Date
}): InboundOrder[] {
  if (!options.customerId || !options.customerCode || options.customerCode === '—') {
    throw new Error('请先选择导入客户，再导入入库预约单')
  }
  const date = options.date ?? new Date()
  const prefix = inboundNoPrefix(options.customerCode, date)
  const first = nextSeqFromNos(options.existingNos, prefix)
  const createdAt = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return rows.map((row, index) => ({
    id: `ib-import-${crypto.randomUUID()}`,
    customerId: options.customerId,
    inboundNo: buildInboundNo(options.customerCode, date, first + index),
    source: '客户自发', inboundType: row.inboundType, deliveryMethod: row.deliveryMethod,
    stockSource: 'owned', boxCount: new Set(row.lines.map(line => line.boxNo)).size,
    skuCount: new Set(row.lines.map(line => line.sku)).size,
    totalQty: row.lines.reduce((sum, line) => sum + line.qty, 0), receivedQty: 0,
    status: 'draft', createdAt, eta: row.eta, warehouse: 'jhb1',
    referenceNo: row.referenceNo || row.platformRef || undefined,
    trackingNo: row.trackingNo, skuHint: row.lines.map(line => line.sku).slice(0, 3).join(', '),
    remark: row.remark, lineItems: row.lines,
  }))
}
