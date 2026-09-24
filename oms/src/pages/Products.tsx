import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Printer, Copy, Pencil, Ban, RotateCcw, Trash2 } from 'lucide-react'
import {
  Badge, Button, Card, PageHeader, MonoCode, Table, TableFooter,
} from '../components/ui'
import {
  TriToggle, SearchField, RangeField, FilterActions, DropdownBtn,
  inputCls, matchTriState, matchText, type TriState, type SearchMode,
} from '../components/ui/filters'
import { Product, type InboundOrder, statusLabels, formatCurrency } from '../data/mockData'
import {
  discardLocalProduct,
  hasLocalProductStock,
  permanentlyDeleteLocalProduct,
  restoreLocalProduct,
  useProducts,
} from '../data/inventoryStore'
import { useInboundOrders } from '../data/entityStore'
import { getPrimaryPlatformBarcode } from '../data/platformBindingUtils'
import { printBarcodeLabels } from '../data/barcodeLabelTemplate'
import { getCustomerSkuDisplay } from '../data/skuCode'
import { useDataScope } from '../auth/useDataScope'
import { AdminCustomerFilter, AdminCustomerCell } from '../components/admin/AdminCustomerFilter'
import { exportProducts } from '../data/importTemplates'
import { deleteErpProduct, disableErpProduct, enableErpProduct } from '../api/erp'

const statusTabs = [
  { id: 'all', label: '全部' },
  { id: 'available', label: '可用' },
  { id: 'draft', label: '草稿' },
  { id: 'discarded', label: '废弃' },
]

interface ProductFilters {
  battery: TriState
  boxSpec: TriState
  sku: string
  skuMode: SearchMode
  customCode: string
  customCodeMode: SearchMode
  productName: string
  productNameMode: SearchMode
  outerBarcode: string
  weightMin: string
  weightMax: string
  valueMin: string
  valueMax: string
}

const defaultFilters: ProductFilters = {
  battery: 'all', boxSpec: 'all',
  sku: '', skuMode: 'exact',
  customCode: '', customCodeMode: 'fuzzy',
  productName: '', productNameMode: 'fuzzy',
  outerBarcode: '',
  weightMin: '', weightMax: '', valueMin: '', valueMax: '',
}

function displaySku(p: Product, customerId?: string | null) {
  return getPrimaryPlatformBarcode(p.internalSku, customerId ?? undefined) ?? getCustomerSkuDisplay(p)
}

function inboundOrderUsesSku(order: InboundOrder, product: Product) {
  if ((order.customerId ?? null) !== (product.customerId ?? null)) return false
  if (order.lineItems?.some(line => line.sku.trim() === product.internalSku)) return true
  return String(order.skuHint || '')
    .split(/[\s,，、]+/)
    .some(sku => sku.trim() === product.internalSku)
}

function applyProductFilters(list: Product[], f: ProductFilters, tab: string, customerId?: string | null) {
  return list.filter(p => {
    if (tab !== 'all' && p.productStatus !== tab) return false
    if (!matchTriState(p.hasBattery, f.battery)) return false
    if (!matchTriState(p.hasBoxSpec, f.boxSpec)) return false
    const skuVal = `${displaySku(p, customerId)} ${p.internalSku}`
    if (!matchText(skuVal, f.sku, f.skuMode)) return false
    if (!matchText(p.customCode ?? '', f.customCode, f.customCodeMode)) return false
    if (!matchText(p.name, f.productName, f.productNameMode)) return false
    if (f.outerBarcode && !(p.outerBoxBarcode ?? '').includes(f.outerBarcode)) return false
    if (f.weightMin && p.weightKg < parseFloat(f.weightMin)) return false
    if (f.weightMax && p.weightKg > parseFloat(f.weightMax)) return false
    if (f.valueMin && p.declaredValue < parseFloat(f.valueMin)) return false
    if (f.valueMax && p.declaredValue > parseFloat(f.valueMax)) return false
    return true
  })
}

export default function Products() {
  const dataScope = useDataScope()
  const barcodeCustomerId = dataScope.bindingCustomerId
  const products = useProducts()
  const inboundOrders = useInboundOrders()
  const [tab, setTab] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState<ProductFilters>(defaultFilters)
  const [applied, setApplied] = useState<ProductFilters>(defaultFilters)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const myProducts = useMemo(
    () => dataScope.scopeProducts(products),
    [dataScope, products],
  )

  const filtered = useMemo(
    () => applyProductFilters(myProducts, applied, tab, barcodeCustomerId),
    [myProducts, applied, tab, barcodeCustomerId],
  )
  const selectedProducts = useMemo(
    () => myProducts.filter(product => selected.has(product.id)),
    [myProducts, selected],
  )

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  const tabCounts = useMemo(() => {
    const base = applyProductFilters(myProducts, applied, 'all', barcodeCustomerId)
    return {
      all: base.length,
      available: base.filter(p => p.productStatus === 'available').length,
      draft: base.filter(p => p.productStatus === 'draft').length,
      discarded: base.filter(p => p.productStatus === 'discarded').length,
    }
  }, [myProducts, applied, barcodeCustomerId])

  const setDraftField = <K extends keyof ProductFilters>(key: K, value: ProductFilters[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  const handleQuery = () => {
    setApplied({ ...draft })
    setPage(1)
  }

  const handleExportAll = () => exportProducts(filtered, dataScope.getCustomerCode)
  const handleExportSelected = () => {
    const picked = filtered.filter(p => selected.has(p.id))
    if (picked.length === 0) {
      window.alert('请先勾选要导出的产品')
      return
    }
    exportProducts(picked, dataScope.getCustomerCode)
  }

  const toggleAll = () => {
    const allFilteredSelected = filtered.length > 0 && filtered.every(product => selected.has(product.id))
    setSelected(prev => {
      const next = new Set(prev)
      filtered.forEach(product => allFilteredSelected ? next.delete(product.id) : next.add(product.id))
      return next
    })
  }

  const printBarcodes = async (items = selectedProducts) => {
    if (items.length === 0) {
      window.alert('请先勾选要打印条码的产品')
      return
    }
    const inputs = items.map(product => ({
      code: product.internalSku.trim() || displaySku(product, barcodeCustomerId),
      copies: 1,
    })).filter(item => item.code)
    await printBarcodeLabels(inputs, 'SKU 标签')
  }

  const isSubmittedProduct = (product: Product) => (
    product.productStatus === 'available'
    || product.productStatus === 'reviewing'
    || (product.productStatus === 'discarded' && product.discardedFrom !== 'draft')
  )

  const isErpProductMissing = (error: unknown) => (
    typeof error === 'object'
    && error !== null
    && 'status' in error
    && (error as { status?: unknown }).status === 404
  )

  const permanentDeleteBlockReason = (product: Product): string | undefined => {
    if (hasLocalProductStock(product.id)) return '该 SKU 仍有库存，不能永久删除；请先清空库存。'
    const inbound = inboundOrders.find(order => inboundOrderUsesSku(order, product))
    return inbound ? `该 SKU 已关联入库单 ${inbound.inboundNo}，不能永久删除。` : undefined
  }

  const handleDiscard = async (product: Product) => {
    if (!window.confirm(`确认废弃商品「${displaySku(product, barcodeCustomerId)}」？可在“废弃”页恢复。`)) return
    try {
      if (isSubmittedProduct(product)) {
        try {
          await disableErpProduct(product.internalSku)
        } catch (error) {
          // Historical OMS cards may not have a corresponding ERP product.
          // They can still be safely moved to the OMS recycle bin.
          if (!isErpProductMissing(error)) throw error
        }
      }
      await discardLocalProduct(product.id)
      setSelected(previous => {
        const next = new Set(previous)
        next.delete(product.id)
        return next
      })
    } catch (error) {
      window.alert(`废弃商品失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleRestore = async (product: Product) => {
    try {
      if (isSubmittedProduct(product)) await enableErpProduct(product.internalSku)
      await restoreLocalProduct(product.id)
    } catch (error) {
      window.alert(`恢复商品失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handlePermanentDelete = async (product: Product) => {
    const blockReason = permanentDeleteBlockReason(product)
    if (blockReason) {
      window.alert(blockReason)
      return
    }
    if (!window.confirm(`确认永久删除商品「${displaySku(product, barcodeCustomerId)}」？关联的本地库存展示记录将一并删除，且无法恢复。`)) return
    try {
      if (isSubmittedProduct(product)) await deleteErpProduct(product.internalSku)
      await permanentlyDeleteLocalProduct(product.id)
      setSelected(previous => {
        const next = new Set(previous)
        next.delete(product.id)
        return next
      })
    } catch (error) {
      window.alert(`永久删除商品失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="我的商品"
        desc={dataScope.isAdmin
          ? '来自 ERP 的 SKU 主数据（含货盘池）；新建产品会写入 ERP，其余字段请在 ERP 维护'
          : '来自 ERP 的 SKU 与申报信息；新建产品会同步 ERP，资料变更请在 ERP 完成'}
      />

      <Card className="mb-4 p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-text-primary">筛选条件</p>
          <button type="button" onClick={() => setFiltersOpen(v => !v)} className="text-xs text-primary-600 hover:underline">
            {filtersOpen ? '收起' : '展开'}
          </button>
        </div>
        {filtersOpen && (
          <div className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-3">
              <TriToggle label="含电池" value={draft.battery} onChange={v => setDraftField('battery', v)} />
              <TriToggle label="产品箱规" value={draft.boxSpec} onChange={v => setDraftField('boxSpec', v)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {dataScope.isAdmin && <AdminCustomerFilter scope={dataScope} />}
              <SearchField label="SKU" value={draft.sku} onChange={v => setDraftField('sku', v)} mode={draft.skuMode} onModeChange={v => setDraftField('skuMode', v)} />
              <SearchField label="自定义编号" value={draft.customCode} onChange={v => setDraftField('customCode', v)} mode={draft.customCodeMode} onModeChange={v => setDraftField('customCodeMode', v)} />
              <SearchField label="产品名称" value={draft.productName} onChange={v => setDraftField('productName', v)} mode={draft.productNameMode} onModeChange={v => setDraftField('productNameMode', v)} />
              <div>
                <label className="mb-1 block text-[11px] font-medium text-text-muted">外箱条码</label>
                <input value={draft.outerBarcode} onChange={e => setDraftField('outerBarcode', e.target.value)} className={inputCls} />
              </div>
              <RangeField label="重量 (KG)" min={draft.weightMin} max={draft.weightMax} onMinChange={v => setDraftField('weightMin', v)} onMaxChange={v => setDraftField('weightMax', v)} />
              <RangeField label="申报价值 (人民币)" min={draft.valueMin} max={draft.valueMax} onMinChange={v => setDraftField('valueMin', v)} onMaxChange={v => setDraftField('valueMax', v)} />
            </div>
            <FilterActions
              align="left"
              onQuery={handleQuery}
              onReset={() => { setDraft(defaultFilters); setApplied(defaultFilters); setPage(1) }}
            />
          </div>
        )}
      </Card>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1 border-b border-border-light pb-px">
          {statusTabs.map(t => {
            const active = tab === t.id
            const count = tabCounts[t.id as keyof typeof tabCounts] ?? 0
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => { setTab(t.id); setPage(1) }}
                className={`status-tab ${active ? 'status-tab-active' : ''}`}
              >
                {t.label}
                <span className={`ml-1 text-xs ${active ? 'text-primary-500' : 'text-text-muted'}`}>
                  ({count})
                </span>
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/products/new"><Button variant="toolbar" size="sm"><Plus className="h-3.5 w-3.5" /> 创建产品</Button></Link>
          <Button variant="toolbar" size="sm" onClick={() => void printBarcodes()}><Printer className="h-3.5 w-3.5" /> 打印条码</Button>
          <DropdownBtn variant="toolbar" label="导出" items={[
            { label: '导出全部', onClick: handleExportAll },
            { label: '导出选中', onClick: handleExportSelected },
          ]} />
        </div>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <thead className="table-head">
            <tr>
              <th className="w-10">
                <input type="checkbox" checked={filtered.length > 0 && filtered.every(product => selected.has(product.id))} onChange={toggleAll} className="rounded border-border" />
              </th>
              <th>SKU</th>
              {dataScope.isAdmin && <th>客户代码</th>}
              <th className="min-w-[300px]">产品</th>
              <th>长*宽*高 (CM)</th>
              <th>重量 (KG)</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody className="table-body">
            {paged.map(p => (
              <tr key={p.id} className="table-row">
                <td className="table-cell">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => setSelected(prev => {
                      const next = new Set(prev)
                      next.has(p.id) ? next.delete(p.id) : next.add(p.id)
                      return next
                    })}
                    className="rounded border-border"
                  />
                </td>
                <td className="table-cell align-top">
                  <Link to={`/products/${p.id}`} className="font-mono text-xs font-medium text-primary-600 hover:underline">
                    {displaySku(p, barcodeCustomerId)}
                  </Link>
                </td>
                <AdminCustomerCell customerId={p.customerId} scope={dataScope} />
                <td className="table-cell">
                  <div className="flex gap-3">
                    {p.image ? (
                      <img src={p.image} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover ring-1 ring-border-light" />
                    ) : (
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-[10px] text-text-muted ring-1 ring-border-light">无图片</div>
                    )}
                    <div className="min-w-0 space-y-0.5 text-[11px] leading-relaxed">
                      <p className="text-sm font-medium text-text-primary">{p.name}</p>
                      <p><span className="text-text-muted">自定义编号：</span>{p.customCode ? <MonoCode>{p.customCode}</MonoCode> : '—'}</p>
                      <p><span className="text-text-muted">英文申报品名：</span>{p.declaredNameEn}</p>
                      <p><span className="text-text-muted">申报价值：</span><span className="font-medium">{formatCurrency(p.declaredValue)}</span></p>
                      <p><span className="text-text-muted">中文申报品名：</span>{p.declaredNameCn}</p>
                      <p><span className="text-text-muted">产品单位：</span>{p.unit}</p>
                    </div>
                  </div>
                </td>
                <td className="table-cell text-xs font-mono whitespace-nowrap">
                  {p.lengthCm.toFixed(2)} * {p.widthCm.toFixed(2)} * {p.heightCm.toFixed(2)}
                </td>
                <td className="table-cell text-xs font-semibold">{p.weightKg.toFixed(3)}</td>
                <td className="table-cell">
                  <Badge status={p.productStatus} label={statusLabels[p.productStatus]} />
                </td>
                <td className="table-cell">
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    {!p.inCatalog && p.productStatus !== 'discarded' && (
                      <>
                        <Link to={`/products/${p.id}/edit`} className="inline-flex items-center gap-0.5 font-medium text-primary-600 hover:underline"><Pencil className="h-3 w-3" /> {p.productStatus === 'draft' ? '编辑草稿' : '编辑商品'}</Link>
                        <button type="button" onClick={() => void handleDiscard(p)} className="inline-flex items-center gap-0.5 font-medium text-amber-700 hover:underline"><Ban className="h-3 w-3" /> 废弃商品</button>
                      </>
                    )}
                    {!p.inCatalog && p.productStatus === 'discarded' && (
                      <>
                        <button type="button" onClick={() => void handleRestore(p)} className="inline-flex items-center gap-0.5 font-medium text-emerald-700 hover:underline"><RotateCcw className="h-3 w-3" /> 恢复</button>
                        <button type="button" disabled={Boolean(permanentDeleteBlockReason(p))} title={permanentDeleteBlockReason(p)} onClick={() => void handlePermanentDelete(p)} className="inline-flex items-center gap-0.5 font-medium text-red-700 hover:underline disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-3 w-3" /> 永久删除</button>
                      </>
                    )}
                    <Link to={`/products/new?copy=${encodeURIComponent(p.id)}`} className="inline-flex items-center gap-0.5 font-medium text-primary-600 hover:underline"><Copy className="h-3 w-3" /> 复制新建</Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <TableFooter
          total={filtered.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={s => { setPageSize(s); setPage(1) }}
        />
      </Card>
    </div>
  )
}
