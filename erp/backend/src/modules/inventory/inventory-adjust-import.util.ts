import { parseCsv } from '../../common/csv.util'

export interface InventoryAdjustImportRow {
  customerCode: string
  sku: string
  warehouseCode: string
  fromLocationCode?: string
  toLocationCode: string
  qty: number
  remark?: string
}

function colIdx(header: string[], aliases: string[]) {
  const lower = aliases.map((a) => a.toLowerCase())
  return header.findIndex((h) => {
    const t = h.trim()
    return lower.includes(t.toLowerCase()) || aliases.includes(t)
  })
}

export function parseInventoryAdjustCsv(content: string, defaultWarehouse = 'WMS-JHB-01'): InventoryAdjustImportRow[] {
  const table = parseCsv(content)
  if (table.length < 2) throw new Error('文件为空或仅有表头')

  const header = table[0].map((h) => h.trim())
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
  for (let i = 1; i < table.length; i++) {
    const cols = table[i]
    const customerCode = cols[customerIdx]?.trim()
    const sku = cols[skuIdx]?.trim()
    const toLocationCode = cols[toLocIdx]?.trim()
    const qtyRaw = cols[qtyIdx]?.trim()
    if (!customerCode && !sku && !toLocationCode && !qtyRaw) continue

    if (!customerCode) throw new Error(`第 ${i + 1} 行：客户代码不能为空`)
    if (!sku) throw new Error(`第 ${i + 1} 行：SKU 不能为空`)
    if (!toLocationCode) throw new Error(`第 ${i + 1} 行：目标库位不能为空`)

    const qty = Number(qtyRaw)
    if (!Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty)) {
      throw new Error(`第 ${i + 1} 行：数量须为非负整数`)
    }

    rows.push({
      customerCode,
      sku,
      warehouseCode: (whIdx >= 0 ? cols[whIdx]?.trim() : '') || defaultWarehouse,
      fromLocationCode: fromLocIdx >= 0 ? cols[fromLocIdx]?.trim() || undefined : undefined,
      toLocationCode,
      qty,
      remark: remarkIdx >= 0 ? cols[remarkIdx]?.trim() || undefined : undefined,
    })
  }

  if (!rows.length) throw new Error('未解析到有效数据行')
  return rows
}
