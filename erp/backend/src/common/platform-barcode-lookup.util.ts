import { OMS_TABLE } from './oms-table-names'
import { deriveCustomerCodeFromInternalSku, deriveCustomerSkuFromInternalSku } from './sku-code.util'

export type PlatformMappingRow = {
  platformBarcode?: string | null
  lines?: string | null
  status?: string | null
}

export type ProductScanFields = {
  barcode: string
  platformBarcode: string
  platformBarcodes: string[]
}

type Queryable = {
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>
}

function uniqueCodes(codes: Array<string | null | undefined>): string[] {
  const out: string[] = []
  for (const raw of codes) {
    const code = String(raw || '').trim()
    if (code && !out.includes(code)) out.push(code)
  }
  return out
}

export function parseMappingInternalSkus(linesJson: string | null | undefined): string[] {
  if (!linesJson?.trim()) return []
  try {
    const parsed = JSON.parse(linesJson)
    const rows = Array.isArray(parsed) ? parsed : []
    return uniqueCodes(rows.map((row) => (row && typeof row === 'object' ? (row as { internalSku?: string }).internalSku : '')))
  } catch {
    return []
  }
}

export function primaryBoundBarcode(codes: string[]): string {
  const list = uniqueCodes(codes)
  return (
    list.find((code) => /^990\d{10}$/i.test(code)) ||
    list.find((code) => /^990\d+$/i.test(code)) ||
    list[0] ||
    ''
  )
}

export function indexPlatformBarcodes(rows: PlatformMappingRow[]): Map<string, string[]> {
  const indexed = new Map<string, string[]>()
  for (const row of rows) {
    if (String(row.status || 'active').trim().toLowerCase() !== 'active') continue
    const barcode = String(row.platformBarcode || '').trim()
    if (!barcode) continue
    for (const sku of parseMappingInternalSkus(row.lines)) {
      const key = sku.toUpperCase()
      const list = indexed.get(key) || []
      if (!list.includes(barcode)) list.push(barcode)
      indexed.set(key, list)
    }
  }
  return indexed
}

export function aliasesForSku(
  sku: string,
  indexed: Map<string, string[]>,
  customerSku?: string | null,
): string[] {
  const keys = uniqueCodes([sku, customerSku])
  const code = deriveCustomerCodeFromInternalSku(sku)
  if (code) keys.push(...uniqueCodes([deriveCustomerSkuFromInternalSku(sku, code)]))
  const out: string[] = []
  for (const key of keys) {
    for (const barcode of indexed.get(key.toUpperCase()) || []) {
      if (!out.includes(barcode)) out.push(barcode)
    }
  }
  return out
}

export function productScanFields(
  sku: string,
  product: { sku?: string | null; barcode?: string | null; customerSku?: string | null } | undefined,
  indexed: Map<string, string[]>,
): ProductScanFields {
  const platformBarcodes = aliasesForSku(sku || product?.sku || '', indexed, product?.customerSku)
  const productBarcode = String(product?.barcode || '').trim()
  const platformBarcode = primaryBoundBarcode(platformBarcodes)
  return {
    barcode: productBarcode || platformBarcode,
    platformBarcode,
    platformBarcodes,
  }
}

export async function loadPlatformBarcodesByInternalSku(
  prisma: Queryable,
  skus: string[],
): Promise<Map<string, string[]>> {
  if (!uniqueCodes(skus).length) return new Map()
  try {
    const rows = await prisma.$queryRawUnsafe<PlatformMappingRow[]>(
      `SELECT platformBarcode, \`lines\`, status FROM ${OMS_TABLE.platformSkuMapping} WHERE status = 'active'`,
    )
    return indexPlatformBarcodes(rows || [])
  } catch {
    return new Map()
  }
}
