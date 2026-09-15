import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Button, MonoCode } from '../ui'
import { formInput } from '../ui/form'
import type { Product, StockSource } from '../../data/mockData'
import { getProductsSnapshot, getOutboundShippableQty } from '../../data/inventoryStore'
import { findProductByCode } from '../../data/platformBindingUtils'
import { getCustomerSkuDisplay } from '../../data/skuCode'

export interface OutboundSkuPickerLine {
  id: string
  sku: string
  name: string
  qty: number
  declaredName: string
  declaredValue: number
  note: string
  source?: 'manual' | 'takealot'
}

export interface OutboundSkuPickerConfirmRow {
  sku: string
  name: string
  qty: number
  declaredName: string
  declaredValue: number
  note: string
  source?: 'manual' | 'takealot'
  existingId?: string
}

type Props = {
  open: boolean
  onClose: () => void
  customerId?: string
  catalogOnly: boolean
  stockSource: StockSource
  lines: OutboundSkuPickerLine[]
  initialSearch?: string
  onConfirm: (rows: OutboundSkuPickerConfirmRow[]) => void
}

function productHaystack(p: Product): string {
  return [
    getCustomerSkuDisplay(p),
    p.customerSku,
    p.internalSku,
    p.customCode,
    p.name,
    p.declaredNameEn,
    p.declaredNameCn,
    p.outerBoxBarcode,
  ].filter(Boolean).join(' ').toLowerCase()
}

function lineSkuKey(sku: string, customerId?: string): string {
  return findProductByCode(sku, customerId)?.internalSku ?? sku.trim()
}

export default function OutboundSkuPickerModal({
  open,
  onClose,
  customerId,
  catalogOnly,
  stockSource,
  lines,
  initialSearch = '',
  onConfirm,
}: Props) {
  const [search, setSearch] = useState('')
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [qtyBySku, setQtyBySku] = useState<Record<string, number>>({})

  const catalog = useMemo(() => {
    let list = getProductsSnapshot()
    if (customerId) list = list.filter(p => !p.customerId || p.customerId === customerId)
    if (catalogOnly) list = list.filter(p => p.inCatalog)
    return list
  }, [customerId, catalogOnly, open])

  const lineByInternalSku = useMemo(() => {
    const map = new Map<string, OutboundSkuPickerLine>()
    for (const line of lines) {
      map.set(lineSkuKey(line.sku, customerId), line)
    }
    return map
  }, [lines, customerId])

  useEffect(() => {
    if (!open) return
    setSearch(initialSearch.trim())
    const nextChecked: Record<string, boolean> = {}
    const nextQty: Record<string, number> = {}
    for (const line of lines) {
      const key = lineSkuKey(line.sku, customerId)
      nextChecked[key] = true
      nextQty[key] = Math.max(1, line.qty)
    }
    setChecked(nextChecked)
    setQtyBySku(nextQty)
  }, [open, lines, customerId, initialSearch])

  type RowItem =
    | { kind: 'product'; product: Product }
    | { kind: 'orphan'; internalSku: string; line: OutboundSkuPickerLine }

  const listItems = useMemo((): RowItem[] => {
    const q = search.trim().toLowerCase()
    const catalogKeys = new Set(catalog.map(p => p.internalSku))
    let products = catalog.filter(
      p => lineByInternalSku.has(p.internalSku)
        || getOutboundShippableQty(p.internalSku, stockSource, customerId) > 0,
    )
    if (q) products = products.filter(p => productHaystack(p).includes(q))

    const orphans: RowItem[] = []
    for (const [internalSku, line] of lineByInternalSku) {
      if (catalogKeys.has(internalSku)) continue
      const hay = [line.sku, line.name, internalSku].join(' ').toLowerCase()
      if (q && !hay.includes(q)) continue
      orphans.push({ kind: 'orphan', internalSku, line })
    }

    const inOrder = lineByInternalSku
    const sortedProducts: RowItem[] = [...products]
      .sort((a, b) => {
        const aIn = inOrder.has(a.internalSku) ? 1 : 0
        const bIn = inOrder.has(b.internalSku) ? 1 : 0
        if (aIn !== bIn) return bIn - aIn
        const aShip = getOutboundShippableQty(a.internalSku, stockSource, customerId)
        const bShip = getOutboundShippableQty(b.internalSku, stockSource, customerId)
        if (aShip !== bShip) return bShip - aShip
        return a.internalSku.localeCompare(b.internalSku)
      })
      .map(product => ({ kind: 'product' as const, product }))

    return [...orphans, ...sortedProducts]
  }, [catalog, search, lineByInternalSku, stockSource, customerId])

  if (!open) return null

  const toggle = (internalSku: string, on: boolean) => {
    setChecked(prev => ({ ...prev, [internalSku]: on }))
    if (on && !qtyBySku[internalSku]) {
      const existing = lineByInternalSku.get(internalSku)
      setQtyBySku(prev => ({
        ...prev,
        [internalSku]: existing ? Math.max(1, existing.qty) : 1,
      }))
    }
  }

  const handleConfirm = () => {
    const rows: OutboundSkuPickerConfirmRow[] = []
    for (const [internalSku, isOn] of Object.entries(checked)) {
      if (!isOn) continue
      const prod = catalog.find(p => p.internalSku === internalSku)
      const existing = lineByInternalSku.get(internalSku)
      const qty = Math.max(1, Math.trunc(qtyBySku[internalSku] || existing?.qty || 1))
      const displaySku = prod ? getCustomerSkuDisplay(prod) : existing?.sku ?? internalSku
      rows.push({
        sku: displaySku,
        name: prod?.name ?? existing?.name ?? displaySku,
        qty,
        declaredName: existing?.declaredName || prod?.declaredNameEn || prod?.name || displaySku,
        declaredValue: existing?.declaredValue ?? prod?.declaredValue ?? prod?.price ?? 0,
        note: existing?.note ?? '',
        source: existing?.source,
        existingId: existing?.id,
      })
    }
    onConfirm(rows)
    onClose()
  }

  const selectedCount = Object.values(checked).filter(Boolean).length

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl ring-1 ring-border-light"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="outbound-sku-picker-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-light px-5 py-4">
          <div>
            <h3 id="outbound-sku-picker-title" className="font-semibold text-text-primary">
              选择出库 SKU
            </h3>
            <p className="mt-1 text-xs text-text-muted">
              支持 SKU / 品名模糊搜索；已在发货单中的 SKU 会默认勾选
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-text-muted hover:bg-slate-100"
            onClick={onClose}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border-light px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              className={formInput('pl-9')}
              placeholder="搜索 SKU、自定义编号或品名"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {listItems.length === 0 ? (
            <li className="px-3 py-10 text-center text-xs text-text-muted">
              {search.trim() ? '没有匹配的 SKU' : '暂无可用商品'}
            </li>
          ) : listItems.map(item => {
            const key = item.kind === 'product' ? item.product.internalSku : item.internalSku
            const isChecked = Boolean(checked[key])
            const shippable = getOutboundShippableQty(key, stockSource, customerId)
            const inOrder = lineByInternalSku.has(key)
            const displaySku = item.kind === 'product'
              ? getCustomerSkuDisplay(item.product)
              : item.line.sku
            const title = item.kind === 'product' ? item.product.name : item.line.name
            return (
              <li
                key={key}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${isChecked ? 'bg-primary-50/80' : 'hover:bg-slate-50'}`}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 rounded border-slate-300 text-primary-600"
                  checked={isChecked}
                  onChange={e => toggle(key, e.target.checked)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <MonoCode>{displaySku}</MonoCode>
                    {inOrder && (
                      <span className="rounded bg-primary-100 px-1.5 py-0.5 text-[10px] font-medium text-primary-800">
                        已在发货单
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-text-muted">{title}</p>
                  <p className="text-[10px] text-text-muted">
                    可发 {shippable.toLocaleString()} 件
                    {stockSource === 'catalog' ? '（货盘锁定）' : ''}
                  </p>
                </div>
                {isChecked && (
                  <div className="shrink-0">
                    <label className="sr-only" htmlFor={`qty-${key}`}>数量</label>
                    <input
                      id={`qty-${key}`}
                      type="number"
                      min={1}
                      className={formInput('w-20 py-1 text-xs')}
                      value={qtyBySku[key] ?? 1}
                      onChange={e => {
                        const n = Math.max(1, Math.trunc(Number(e.target.value) || 1))
                        setQtyBySku(prev => ({ ...prev, [key]: n }))
                      }}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        <div className="flex items-center justify-between gap-3 border-t border-border-light px-5 py-4">
          <p className="text-xs text-text-muted">已选 {selectedCount} 个 SKU</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>
            <Button size="sm" onClick={handleConfirm} disabled={selectedCount === 0}>
              确定
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
