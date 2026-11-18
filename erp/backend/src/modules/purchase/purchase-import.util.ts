import { normalizeImportHeader, parseNumberedImportCsv } from '../../common/csv.util'
import type { ImportRowFailure } from '../../common/import-row-result.util'

/** 与前端「创建采购单」表单字段一致。相同表头信息的行合并为一张采购单。 */
export const PURCHASE_IMPORT_HEADERS = [
  '供应商',
  '目标中转仓',
  '预计到货',
  '国内运费',
  '备注',
  'SKU',
  '商品名称',
  '采购数量',
  '单价',
  '行备注',
] as const

export const PURCHASE_IMPORT_MAX_ROWS = 500

export interface ParsedPurchaseImportLine {
  lineNo: number
  supplierName: string
  warehouseKey: string
  expectedArrival?: string
  domesticFreight?: number
  orderRemark?: string
  sku: string
  productName?: string
  quantity: number
  unitPrice: number
  lineRemark?: string
}

export interface PurchaseImportParseResult {
  lines: ParsedPurchaseImportLine[]
  failures: ImportRowFailure[]
  /** 含超出明细上限后不再展开的失败行 */
  failureCount: number
}

export interface PurchaseImportGroup {
  supplierName: string
  warehouseKey: string
  expectedArrival?: string
  domesticFreight?: number
  orderRemark?: string
  lines: ParsedPurchaseImportLine[]
}

function colIdx(header: string[], aliases: string[]) {
  const lower = aliases.map((alias) => alias.toLowerCase())
  return header.findIndex((cell) => {
    const text = cell.trim()
    return lower.includes(text.toLowerCase()) || aliases.includes(text)
  })
}

function cell(cols: string[], index: number) {
  return index >= 0 ? cols[index]?.trim() || '' : ''
}

function parseExpectedArrival(raw: string): { ok: true; value?: string } | { ok: false } {
  if (!raw) return { ok: true }
  const matched = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T].*)?$/)
  if (!matched) return { ok: false }
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { ok: false }
  }
  return { ok: true, value: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` }
}

function parseMoney(raw: string, allowZero: boolean): { ok: true; value?: number } | { ok: false } {
  if (!raw) return allowZero ? { ok: true } : { ok: false }
  if (!/^\d+(\.\d+)?$/.test(raw)) return { ok: false }
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount < 0 || amount > 9999999999.99) return { ok: false }
  const value = Math.round(amount * 100) / 100
  if (!allowZero && value <= 0) return { ok: false }
  if (value === 0) return { ok: true }
  return { ok: true, value }
}

function parseQuantity(raw: string) {
  if (!/^\d+$/.test(raw)) return null
  const quantity = Number(raw)
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647) return null
  return quantity
}

export function purchaseImportGroupKey(line: Pick<ParsedPurchaseImportLine, 'supplierName' | 'warehouseKey' | 'expectedArrival' | 'domesticFreight' | 'orderRemark'>) {
  return [
    line.supplierName.trim().toLowerCase(),
    line.warehouseKey.trim().toLowerCase(),
    line.expectedArrival || '',
    line.domesticFreight == null ? '' : line.domesticFreight.toFixed(2),
    line.orderRemark || '',
  ].join('\u0001')
}

export function groupPurchaseImportLines(lines: ParsedPurchaseImportLine[]): PurchaseImportGroup[] {
  const groups = new Map<string, PurchaseImportGroup>()
  for (const line of lines) {
    const key = purchaseImportGroupKey(line)
    const existing = groups.get(key)
    if (existing) {
      existing.lines.push(line)
      continue
    }
    groups.set(key, {
      supplierName: line.supplierName,
      warehouseKey: line.warehouseKey,
      expectedArrival: line.expectedArrival,
      domesticFreight: line.domesticFreight,
      orderRemark: line.orderRemark,
      lines: [line],
    })
  }
  return [...groups.values()]
}

export function resolveLogisticsWarehouseCode(
  key: string,
  warehouses: { warehouseCode: string; warehouseName: string }[],
): { code?: string; ambiguous?: boolean } {
  const normalized = key.trim().toLowerCase()
  if (!normalized) return {}
  const byCode = warehouses.filter((warehouse) => warehouse.warehouseCode.trim().toLowerCase() === normalized)
  if (byCode.length === 1) return { code: byCode[0].warehouseCode }
  if (byCode.length > 1) return { ambiguous: true }
  const byName = warehouses.filter((warehouse) => warehouse.warehouseName.trim().toLowerCase() === normalized)
  if (byName.length === 1) return { code: byName[0].warehouseCode }
  if (byName.length > 1) return { ambiguous: true }
  return {}
}

export function buildPurchaseImportPoNo(seq: number, now = Date.now()) {
  const stamp = now.toString(36).toUpperCase()
  const salt = Math.floor(Math.random() * 36 ** 3).toString(36).toUpperCase().padStart(3, '0')
  return `PO-${stamp}${salt}${seq.toString(36).toUpperCase()}`.slice(0, 30)
}

export function parsePurchaseImportCsv(content: string): PurchaseImportParseResult {
  const rows = parseNumberedImportCsv(content)
  if (rows.length < 2) return { lines: [], failures: [], failureCount: 0 }
  const header = rows[0].cells.map(normalizeImportHeader)
  const supplierIdx = colIdx(header, ['供应商', 'supplier', 'supplierName'])
  const warehouseIdx = colIdx(header, ['目标中转仓', '中转仓', '仓库', 'warehouse', 'warehouseCode'])
  const arrivalIdx = colIdx(header, ['预计到货', '到货日期', 'expectedArrival'])
  const freightIdx = colIdx(header, ['国内运费', '运费', 'domesticFreight'])
  const remarkIdx = colIdx(header, ['备注', '订单备注', 'remark'])
  const skuIdx = colIdx(header, ['SKU', 'sku'])
  const nameIdx = colIdx(header, ['商品名称', 'productName', '名称'])
  const qtyIdx = colIdx(header, ['采购数量', '数量', 'quantity', 'qty'])
  const priceIdx = colIdx(header, ['单价', '采购单价', 'unitPrice'])
  const lineRemarkIdx = colIdx(header, ['行备注', '明细备注', 'lineRemark'])

  if (supplierIdx < 0) throw new Error('CSV 需包含「供应商」列')
  if (warehouseIdx < 0) throw new Error('CSV 需包含「目标中转仓」列')
  if (skuIdx < 0) throw new Error('CSV 需包含「SKU」列')
  if (qtyIdx < 0) throw new Error('CSV 需包含「采购数量」列')
  if (priceIdx < 0) throw new Error('CSV 需包含「单价」列')

  const lines: ParsedPurchaseImportLine[] = []
  const failures: ImportRowFailure[] = []
  let failureCount = 0
  for (const { cells: cols, lineNo } of rows.slice(1)) {
    const supplierName = cell(cols, supplierIdx)
    const warehouseKey = cell(cols, warehouseIdx)
    const arrivalRaw = cell(cols, arrivalIdx)
    const freightRaw = cell(cols, freightIdx)
    const orderRemark = cell(cols, remarkIdx)
    const sku = cell(cols, skuIdx)
    const productName = cell(cols, nameIdx)
    const quantityRaw = cell(cols, qtyIdx)
    const priceRaw = cell(cols, priceIdx)
    const lineRemark = cell(cols, lineRemarkIdx)
    if (!supplierName && !warehouseKey && !arrivalRaw && !freightRaw && !orderRemark && !sku && !productName && !quantityRaw && !priceRaw && !lineRemark) {
      continue
    }

    const before = failures.length
    const fail = (field: string, reason: string) => {
      failures.push({ lineNo, field, reason, ...(sku ? { sku } : {}), row: cols.join(',').slice(0, 500) })
    }
    if (!supplierName) fail('供应商', '不能为空')
    else if (supplierName.length > 200) fail('供应商', '不能超过 200 字')
    if (!warehouseKey) fail('目标中转仓', '不能为空')
    else if (warehouseKey.length > 100) fail('目标中转仓', '不能超过 100 字')
    if (!sku) fail('SKU', '不能为空')
    else if (sku.length > 30) fail('SKU', '不能超过 30 字')
    if (productName.length > 300) fail('商品名称', '不能超过 300 字')
    if (orderRemark.length > 2000) fail('备注', '不能超过 2000 字')
    if (lineRemark.length > 500) fail('行备注', '不能超过 500 字')

    const arrival = parseExpectedArrival(arrivalRaw)
    if (!arrival.ok) fail('预计到货', '无效，请按年-月-日填写，例如 2026-11-11')
    const freight = parseMoney(freightRaw, true)
    if (!freight.ok) fail('国内运费', '须为不小于 0 的金额')
    const quantity = parseQuantity(quantityRaw)
    if (quantity == null) fail('采购数量', '须为 1 至 2147483647 的整数')
    const unitPrice = parseMoney(priceRaw, false)
    if (!unitPrice.ok || unitPrice.value == null) fail('单价', '须为大于 0 的金额')

    if (failures.length > before || quantity == null || !arrival.ok || !freight.ok || !unitPrice.ok || unitPrice.value == null) {
      failureCount++
      continue
    }

    lines.push({
      lineNo,
      supplierName,
      warehouseKey,
      expectedArrival: arrival.value,
      domesticFreight: freight.value,
      orderRemark: orderRemark || undefined,
      sku,
      productName: productName || undefined,
      quantity,
      unitPrice: unitPrice.value,
      lineRemark: lineRemark || undefined,
    })
  }

  return { lines, failures, failureCount }
}
