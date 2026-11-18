import { normalizeImportHeader, parseNumberedImportCsv } from '../../common/csv.util'

export interface InventoryAdjustImportRow {
  customerCode: string
  sku: string
  warehouseCode: string
  fromLocationCode?: string
  toLocationCode: string
  qty: number
  remark?: string
  sourceLineNo?: number
}

function colIdx(header: string[], aliases: string[]) {
  const lower = aliases.map((a) => a.toLowerCase())
  return header.findIndex((h) => {
    const t = h.trim()
    return lower.includes(t.toLowerCase()) || aliases.includes(t)
  })
}

export function parseInventoryAdjustCsv(content: string, defaultWarehouse = 'WMS-JHB-01'): InventoryAdjustImportRow[] {
  const table = parseNumberedImportCsv(content)
  if (table.length < 2) throw new Error('文件为空或仅有表头')

  const header = table[0].cells.map(normalizeImportHeader)
  const customerIdx = colIdx(header, ['客户代码', '客户编码', 'customerCode', 'customer'])
  const skuIdx = colIdx(header, ['SKU', 'sku', '系统SKU', '客户SKU'])
  const whIdx = colIdx(header, ['仓库', '仓库代码', 'warehouseCode', 'warehouse'])
  const fromLocIdx = colIdx(header, ['原库位', '源库位', 'fromLocation', 'from'])
  const toLocIdx = colIdx(header, ['目标库位', '库位', 'toLocation', 'location'])
  const qtyIdx = colIdx(header, ['数量', '库存数量', 'qty', 'quantity'])
  const remarkIdx = colIdx(header, ['备注', 'remark'])

  if (customerIdx < 0) throw new Error('CSV 需包含「客户代码」列')
  if (skuIdx < 0) throw new Error('CSV 需包含「SKU」列')
  if (toLocIdx < 0) throw new Error('CSV 需包含「目标库位」或「库位」列')
  if (qtyIdx < 0) throw new Error('CSV 需包含「数量」列')

  const rows: InventoryAdjustImportRow[] = []
  const failures: string[] = []
  for (const { cells: cols, lineNo } of table.slice(1)) {
    const customerCode = cols[customerIdx]?.trim()
    const sku = cols[skuIdx]?.trim()
    const toLocationCode = cols[toLocIdx]?.trim()
    const qtyRaw = cols[qtyIdx]?.trim()
    if (!cols.some(cell => cell.trim())) continue
    const fail = (field: string, reason: string) => { failures.push(`第 ${lineNo} 行，字段 ${field}：${reason}`) }
    if (!customerCode) fail('客户代码', '不能为空')
    if (!sku) fail('SKU', '不能为空')
    if (!toLocationCode) fail('目标库位', '不能为空')
    const qty = Number(qtyRaw)
    const validQty = Number.isInteger(qty) && qty >= 0
    if (!qtyRaw) fail('数量', '不能为空；零库存请填写 0')
    else if (!validQty) fail('数量', '须为非负整数')
    if (!customerCode || !sku || !toLocationCode || !qtyRaw || !validQty) continue

    rows.push({
      customerCode,
      sku,
      warehouseCode: (whIdx >= 0 ? cols[whIdx]?.trim() : '') || defaultWarehouse,
      fromLocationCode: fromLocIdx >= 0 ? cols[fromLocIdx]?.trim() || undefined : undefined,
      toLocationCode,
      qty,
      sourceLineNo: lineNo,
      remark: remarkIdx >= 0 ? cols[remarkIdx]?.trim() || undefined : undefined,
    })
  }

  if (failures.length) throw new Error(failures.join('\n'))
  if (!rows.length) throw new Error('未解析到有效数据行')
  return rows
}
