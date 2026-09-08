import { reportLineCbm, roundCbm } from '../management-loop/management-loop-report.util'
import type { ProductDimensionFields } from '../../common/product-dimension.util'

export type FreightCargoItem = {
  sku: string
  productName?: string | null
  qty?: number | null
  quantity?: number | null
}

export type FreightSkuLine = {
  sku: string
  productName: string
  qty: number
  areaCbm: number
  sharePct: number
}

export type FreightSkuDetails = {
  items: FreightSkuLine[]
  totalAreaCbm: number
}

export function parseCargoItems(raw: unknown): FreightCargoItem[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const sku = String(row.sku || '').trim()
    if (!sku) return []
    return [{
      sku,
      productName: row.productName != null ? String(row.productName) : '',
      qty: Number(row.qty ?? row.quantity ?? 0),
      quantity: Number(row.quantity ?? row.qty ?? 0),
    }]
  })
}

export function mergeCargoItems(items: FreightCargoItem[]): Array<{ sku: string; productName: string; qty: number }> {
  const map = new Map<string, { sku: string; productName: string; qty: number }>()
  for (const item of items) {
    const sku = String(item.sku || '').trim()
    if (!sku) continue
    const qty = Number(item.qty ?? item.quantity ?? 0)
    if (!Number.isFinite(qty) || qty <= 0) continue
    const prev = map.get(sku)
    if (prev) {
      prev.qty += qty
      if (!prev.productName && item.productName) prev.productName = String(item.productName)
    } else {
      map.set(sku, {
        sku,
        productName: String(item.productName || '').trim(),
        qty,
      })
    }
  }
  return [...map.values()]
}

export function allocateFreightArea(
  items: FreightCargoItem[],
  productsBySku: Map<string, ProductDimensionFields & { productName?: string | null }>,
): FreightSkuDetails {
  const merged = mergeCargoItems(items)
  const withArea = merged.map((item) => {
    const product = productsBySku.get(item.sku)
    return {
      sku: item.sku,
      productName: item.productName || String(product?.productName || '').trim(),
      qty: item.qty,
      areaCbm: roundCbm(reportLineCbm(product, item.qty)),
    }
  })
  const totalAreaCbm = roundCbm(withArea.reduce((sum, item) => sum + item.areaCbm, 0))
  return {
    totalAreaCbm,
    items: withArea.map((item) => ({
      ...item,
      sharePct: totalAreaCbm > 0 ? Number(((item.areaCbm / totalAreaCbm) * 100).toFixed(1)) : 0,
    })),
  }
}

export function readStoredSkuDetails(raw: unknown): FreightSkuDetails | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as { items?: unknown; totalAreaCbm?: unknown }
  if (!Array.isArray(row.items)) return null
  const items = row.items.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const line = item as Record<string, unknown>
    const sku = String(line.sku || '').trim()
    if (!sku) return []
    return [{
      sku,
      productName: String(line.productName || ''),
      qty: Number(line.qty || 0),
      areaCbm: Number(line.areaCbm || 0),
      sharePct: Number(line.sharePct || 0),
    }]
  })
  return {
    items,
    totalAreaCbm: Number(row.totalAreaCbm || items.reduce((sum, item) => sum + item.areaCbm, 0)),
  }
}
