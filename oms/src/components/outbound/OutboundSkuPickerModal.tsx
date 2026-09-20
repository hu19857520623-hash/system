import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Settings2, X } from 'lucide-react'
import { Button, MonoCode, Table } from '../ui'
import { formInput } from '../ui/form'
import type { Product, StockSource } from '../../data/mockData'
import {
  getProductsSnapshot,
  getOutboundShippableQty,
  listShippableOutboundItems,
} from '../../data/inventoryStore'
import { findProductByCode } from '../../data/platformBindingUtils'
import { getCustomerSkuDisplay } from '../../data/skuCode'

const PAGE_SIZE = 10
const MAX_SKU_TOKENS = 200
const QUALITY_LABEL = '良品'

export interface OutboundSkuPickerLine {
  id: string
  sku: string
  name: string
  qty: number
  declaredName: string
  declaredValue: number
  note: string
  source?: 'manual' | 'takealot'
  needsRelabel?: boolean
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
  needsRelabel?: boolean
}

type Props = {
  open: boolean
  onClose: () => void
  customerId?: string
  catalogOnly: boolean
  stockSource: StockSource | 'auto'
  lines: OutboundSkuPickerLine[]
  initialSearch?: string
  onConfirm: (rows: OutboundSkuPickerConfirmRow[]) => void
}

type RowItem =
  | { kind: 'product'; product: Product }
  | { kind: 'orphan'; internalSku: string; line: OutboundSkuPickerLine }

function lineSkuKey(sku: string, customerId?: string): string {
  return findProductByCode(sku, customerId)?.internalSku ?? sku.trim()
}

function parseSkuTokens(raw: string): string[] {
  return raw
    .split(/[,，\n]+/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, MAX_SKU_TOKENS)
}

function productSkuHaystack(p: Product): string[] {
  return [
    getCustomerSkuDisplay(p),
    p.customerSku,
    p.internalSku,
    p.customCode,
    p.outerBoxBarcode,
  ].filter((s): s is string => Boolean(s)).map(s => s.toLowerCase())
}

function productMatchesSkuTokens(p: Product, tokens: string[]): boolean {
  if (tokens.length === 0) return true
  const hay = productSkuHaystack(p)
  return tokens.some(tok => hay.some(h => h === tok || h.includes(tok)))
}

function productMatchesName(p: Product, nameQ: string): boolean {
  const q = nameQ.trim().toLowerCase()
  if (!q) return true
  const hay = [p.name, p.declaredNameEn, p.declaredNameCn].filter(Boolean).join(' ').toLowerCase()
  return hay.includes(q)
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
  const [skuDraft, setSkuDraft] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [skuFilter, setSkuFilter] = useState('')
  const [nameFilter, setNameFilter] = useState('')
  const [page, setPage] = useState(1)
  const [jumpPage, setJumpPage] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [qtyBySku, setQtyBySku] = useState<Record<string, number>>({})

  const catalog = useMemo(() => {
    void refreshKey
    const holdings = listShippableOutboundItems(customerId, { catalogOnly })
    const holdingKeys = new Set(holdings.flatMap(item => [item.sku.toLowerCase()]))
    let list = getProductsSnapshot()
    list = list.filter(p => {
      const ownedByCustomer = !customerId || !p.customerId || p.customerId === customerId
      const hasHolding = holdingKeys.has(p.internalSku.toLowerCase())
        || (p.customerSku ? holdingKeys.has(p.customerSku.toLowerCase()) : false)
      if (catalogOnly) return p.inCatalog || hasHolding
      return ownedByCustomer || hasHolding
    })
    return list
  }, [customerId, catalogOnly, open, refreshKey])

  const lineByInternalSku = useMemo(() => {
    const map = new Map<string, OutboundSkuPickerLine>()
    for (const line of lines) {
      map.set(lineSkuKey(line.sku, customerId), line)
    }
    return map
  }, [lines, customerId])

  useEffect(() => {
    if (!open) return
    const seed = initialSearch.trim()
    setSkuDraft(seed)
    setNameDraft('')
    setSkuFilter('')
    setNameFilter('')
    setPage(1)
    setJumpPage('')
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

  const skuTokens = useMemo(() => parseSkuTokens(skuFilter), [skuFilter])

  const listItems = useMemo((): RowItem[] => {
    const catalogKeys = new Set(catalog.flatMap(p => [
      p.internalSku.toLowerCase(),
      (p.customerSku || '').toLowerCase(),
      getCustomerSkuDisplay(p).toLowerCase(),
    ].filter(Boolean)))
    let products = catalog.filter(
      p => lineByInternalSku.has(p.internalSku)
        || getOutboundShippableQty(p.internalSku, stockSource, customerId) > 0,
    )
    products = products.filter(p => productMatchesSkuTokens(p, skuTokens) && productMatchesName(p, nameFilter))

    const orphans: RowItem[] = []
    const seenOrphans = new Set<string>()
    const pushOrphan = (internalSku: string, line: OutboundSkuPickerLine) => {
      const key = internalSku.toLowerCase()
      if (catalogKeys.has(key) || seenOrphans.has(key)) return
      const skuHay = [line.sku, internalSku].map(s => s.toLowerCase())
      const skuOk = skuTokens.length === 0 || skuTokens.some(tok => skuHay.some(h => h === tok || h.includes(tok)))
      const nameOk = !nameFilter.trim() || line.name.toLowerCase().includes(nameFilter.trim().toLowerCase())
      if (!skuOk || !nameOk) return
      seenOrphans.add(key)
      orphans.push({ kind: 'orphan', internalSku, line })
    }
    for (const [internalSku, line] of lineByInternalSku) {
      pushOrphan(internalSku, line)
    }
    for (const holding of listShippableOutboundItems(customerId, { catalogOnly })) {
      pushOrphan(holding.sku, {
        id: `inv-${holding.sku}`,
        sku: holding.sku,
        name: holding.name,
        qty: 1,
        declaredName: holding.name,
        declaredValue: 0,
        note: '',
      })
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
  }, [catalog, skuTokens, nameFilter, lineByInternalSku, stockSource, customerId, catalogOnly])

  const total = listItems.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageStart = total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1
  const pageEnd = Math.min(safePage * PAGE_SIZE, total)
  const pageItems = listItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  if (!open) return null

  const rowKey = (item: RowItem) => (item.kind === 'product' ? item.product.internalSku : item.internalSku)

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

  const pageKeys = pageItems.map(rowKey)
  const allPageChecked = pageKeys.length > 0 && pageKeys.every(k => checked[k])
  const somePageChecked = pageKeys.some(k => checked[k])

  const togglePageAll = () => {
    const next = !allPageChecked
    setChecked(prev => {
      const copy = { ...prev }
      for (const key of pageKeys) copy[key] = next
      return copy
    })
    if (next) {
      setQtyBySku(prev => {
        const copy = { ...prev }
        for (const key of pageKeys) {
          if (!copy[key]) {
            const existing = lineByInternalSku.get(key)
            copy[key] = existing ? Math.max(1, existing.qty) : 1
          }
        }
        return copy
      })
    }
  }

  const runSearch = () => {
    setSkuFilter(skuDraft)
    setNameFilter(nameDraft)
    setPage(1)
  }

  const resetSearch = () => {
    setSkuDraft('')
    setNameDraft('')
    setSkuFilter('')
    setNameFilter('')
    setPage(1)
  }

  const handleJump = () => {
    const n = Math.trunc(Number(jumpPage))
    if (!Number.isFinite(n) || n < 1) return
    setPage(Math.min(totalPages, n))
    setJumpPage('')
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
        sku: prod?.internalSku ?? existing?.sku ?? internalSku,
        name: prod?.name ?? existing?.name ?? displaySku,
        qty,
        declaredName: existing?.declaredName || prod?.declaredNameEn || prod?.name || displaySku,
        declaredValue: existing?.declaredValue ?? prod?.declaredValue ?? prod?.price ?? 0,
        note: existing?.note ?? '',
        source: existing?.source,
        existingId: existing?.id,
        needsRelabel: existing?.needsRelabel,
      })
    }
    onConfirm(rows)
    onClose()
  }

  const selectedCount = Object.values(checked).filter(Boolean).length

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl ring-1 ring-slate-200"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="outbound-sku-picker-title"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 id="outbound-sku-picker-title" className="text-base font-semibold text-slate-800">
            SKU库存
          </h3>
          <button
            type="button"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-slate-100 px-5 py-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-600">SKU</label>
              <input
                className={formInput('text-sm')}
                placeholder="请输入SKU查询，多个SKU请用「,」分隔，最多允许200个SKU"
                value={skuDraft}
                onChange={e => setSkuDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') runSearch() }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600">产品名称</label>
              <input
                className={formInput('text-sm')}
                placeholder="请输入产品名称"
                value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') runSearch() }}
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={resetSearch}>重置</Button>
            <Button size="sm" onClick={runSearch}>查询</Button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-1 border-b border-slate-100 px-3 py-1.5">
          <button
            type="button"
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
            title="刷新"
            onClick={() => setRefreshKey(k => k + 1)}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded p-1.5 text-slate-400"
            title="列设置（暂未开放）"
            disabled
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5">
          <Table className="w-full text-sm">
            <thead className="table-head sticky top-0 z-[1] bg-slate-50">
              <tr>
                <th className="w-10 px-2 py-2.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300"
                    checked={allPageChecked}
                    ref={el => {
                      if (el) el.indeterminate = !allPageChecked && somePageChecked
                    }}
                    onChange={togglePageAll}
                    aria-label="全选当前页"
                  />
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-slate-600">SKU</th>
                <th className="px-3 py-2.5 text-left font-medium text-slate-600">质量</th>
                <th className="w-24 px-3 py-2.5 text-left font-medium text-slate-600">库存</th>
                <th className="px-3 py-2.5 text-left font-medium text-slate-600">产品名称</th>
              </tr>
            </thead>
            <tbody className="table-body">
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="table-cell py-12 text-center text-sm text-text-muted">
                    暂无数据，请调整查询条件
                  </td>
                </tr>
              ) : pageItems.map(item => {
                const key = rowKey(item)
                const isChecked = Boolean(checked[key])
                const shippable = getOutboundShippableQty(key, stockSource, customerId)
                const displaySku = item.kind === 'product'
                  ? getCustomerSkuDisplay(item.product)
                  : item.line.sku
                const title = item.kind === 'product' ? item.product.name : item.line.name
                return (
                  <tr key={key} className={`table-row ${isChecked ? 'bg-primary-50/40' : ''}`}>
                    <td className="table-cell w-10 px-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-primary-600"
                        checked={isChecked}
                        onChange={e => toggle(key, e.target.checked)}
                      />
                    </td>
                    <td className="table-cell px-3 text-xs">
                      <MonoCode>{displaySku}</MonoCode>
                    </td>
                    <td className="table-cell px-3 text-xs text-slate-700">{QUALITY_LABEL}</td>
                    <td className="table-cell px-3 text-xs tabular-nums text-slate-800">{shippable}</td>
                    <td className="table-cell max-w-[240px] truncate px-3 text-xs text-slate-700" title={title}>
                      {title}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
          <p className="text-xs text-slate-500">
            第 {pageStart}-{pageEnd} 条 / 总共 {total} 条
            {selectedCount > 0 && ` · 已选 ${selectedCount} 个 SKU`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="min-w-[2rem] rounded border border-slate-200 px-2 py-1 text-xs disabled:opacity-40"
              disabled={safePage <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              ‹
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
              .map((p, idx, arr) => {
                const prev = arr[idx - 1]
                const showEllipsis = prev != null && p - prev > 1
                return (
                  <span key={p} className="flex items-center gap-1">
                    {showEllipsis && <span className="px-1 text-xs text-slate-400">…</span>}
                    <button
                      type="button"
                      className={`min-w-[2rem] rounded px-2 py-1 text-xs ${
                        p === safePage
                          ? 'border border-primary-500 bg-primary-50 text-primary-700'
                          : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </button>
                  </span>
                )
              })}
            <button
              type="button"
              className="min-w-[2rem] rounded border border-slate-200 px-2 py-1 text-xs disabled:opacity-40"
              disabled={safePage >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              ›
            </button>
            <span className="ml-2 flex items-center gap-1 text-xs text-slate-500">
              跳至
              <input
                className={formInput('w-12 py-0.5 text-center text-xs')}
                value={jumpPage}
                onChange={e => setJumpPage(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => { if (e.key === 'Enter') handleJump() }}
              />
              页
            </span>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={handleConfirm} disabled={selectedCount === 0}>
            确定
          </Button>
        </div>
      </div>
    </div>
  )
}
