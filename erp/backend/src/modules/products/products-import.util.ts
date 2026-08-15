import { parseCsv } from '../../common/csv.util'

/** 与前端 ProductsView 创建商品表单列名一致 */
export const PRODUCT_IMPORT_HEADERS = [
  'SKU',
  'SPU',
  '商品名称',
  '规格',
  '采购成本(RMB)',
  '长(cm)',
  '宽(cm)',
  '高(cm)',
  '重量(kg)',
  '条码',
  '开发人',
  '采购员',
  '供应商',
  '状态',
] as const

function colIdx(header: string[], aliases: string[]) {
  const lower = aliases.map((a) => a.toLowerCase())
  return header.findIndex((h) => {
    const t = h.trim()
    return lower.includes(t.toLowerCase()) || aliases.includes(t)
  })
}

function parseOptionalNum(raw: string | undefined): number | undefined {
  const s = raw?.trim()
  if (!s) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

export function parseProductStatus(raw?: string): string {
  const s = (raw || '').trim().toLowerCase()
  if (!s || s === '已生效' || s === 'active') return 'active'
  if (s === '待完善' || s === '待完善主数据' || s === 'pending') return 'pending'
  if (s === '已停用' || s === 'inactive') return 'inactive'
  return 'active'
}

export interface ParsedProductImportRow {
  sku: string
  spu?: string
  productName: string
  spec?: string
  costRmb?: number
  lengthCm?: number
  widthCm?: number
  heightCm?: number
  weightKg?: number
  barcode?: string
  developerKey?: string
  purchaserKey?: string
  supplierKey?: string
  status: string
}

export function parseProductsImportCsv(content: string): ParsedProductImportRow[] {
  const rows = parseCsv(content)
  if (rows.length < 2) return []
  const header = rows[0].map((h) => h.trim())
  const skuIdx = colIdx(header, ['SKU', 'sku'])
  const spuIdx = colIdx(header, ['SPU', 'spu'])
  const nameIdx = colIdx(header, ['商品名称', 'productName', 'product_name', '名称'])
  const specIdx = colIdx(header, ['规格', 'spec'])
  const costIdx = colIdx(header, ['采购成本(RMB)', '采购成本', 'costRmb', 'cost_rmb'])
  const lengthIdx = colIdx(header, ['长(cm)', '长', 'lengthCm', 'length'])
  const widthIdx = colIdx(header, ['宽(cm)', '宽', 'widthCm', 'width'])
  const heightIdx = colIdx(header, ['高(cm)', '高', 'heightCm', 'height'])
  const weightIdx = colIdx(header, ['重量(kg)', '重量', 'weightKg', 'weight'])
  const barcodeIdx = colIdx(header, ['条码', 'barcode'])
  const developerIdx = colIdx(header, ['开发人', 'developer', 'developerName'])
  const purchaserIdx = colIdx(header, ['采购员', 'purchaser', 'purchaserName'])
  const supplierIdx = colIdx(header, ['供应商', 'supplier', 'supplierName'])
  const statusIdx = colIdx(header, ['状态', 'status'])

  if (skuIdx < 0) throw new Error('CSV 需包含「SKU」列')
  if (nameIdx < 0) throw new Error('CSV 需包含「商品名称」列')

  const parsed: ParsedProductImportRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i]
    const sku = cols[skuIdx]?.trim()
    const productName = cols[nameIdx]?.trim()
    if (!sku || !productName) continue
    parsed.push({
      sku,
      spu: spuIdx >= 0 ? cols[spuIdx]?.trim() || undefined : undefined,
      productName,
      spec: specIdx >= 0 ? cols[specIdx]?.trim() || undefined : undefined,
      costRmb: costIdx >= 0 ? parseOptionalNum(cols[costIdx]) : undefined,
      lengthCm: lengthIdx >= 0 ? parseOptionalNum(cols[lengthIdx]) : undefined,
      widthCm: widthIdx >= 0 ? parseOptionalNum(cols[widthIdx]) : undefined,
      heightCm: heightIdx >= 0 ? parseOptionalNum(cols[heightIdx]) : undefined,
      weightKg: weightIdx >= 0 ? parseOptionalNum(cols[weightIdx]) : undefined,
      barcode: barcodeIdx >= 0 ? cols[barcodeIdx]?.trim() || undefined : undefined,
      developerKey: developerIdx >= 0 ? cols[developerIdx]?.trim() || undefined : undefined,
      purchaserKey: purchaserIdx >= 0 ? cols[purchaserIdx]?.trim() || undefined : undefined,
      supplierKey: supplierIdx >= 0 ? cols[supplierIdx]?.trim() || undefined : undefined,
      status: statusIdx >= 0 ? parseProductStatus(cols[statusIdx]) : 'active',
    })
  }
  return parsed
}
