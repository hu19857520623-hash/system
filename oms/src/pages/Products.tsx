import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Download, Plus, Printer, Pencil, Copy, Image, Trash2, X } from 'lucide-react'
import {
  Badge, Button, Card, PageHeader, MonoCode, Table, TableFooter,
} from '../components/ui'
import {
  TriToggle, SearchField, RangeField, FilterActions, DropdownBtn,
  inputCls, matchTriState, matchText, type TriState, type SearchMode,
} from '../components/ui/filters'
import { Product, statusLabels, formatCurrency } from '../data/mockData'
import { importProducts, updateLocalProducts, approveProducts, useProducts } from '../data/inventoryStore'
import { getPrimaryPlatformBarcode } from '../data/platformBindingUtils'
import { printBarcodeLabels } from '../data/barcodeLabelTemplate'
import { getCustomerSkuDisplay } from '../data/skuCode'
import { notifyIfUserError } from '../utils/userNotify'
import { useDataScope } from '../auth/useDataScope'
import { AdminCustomerFilter, AdminCustomerCell } from '../components/admin/AdminCustomerFilter'
import { useRole } from '../auth/RoleContext'
import { getCustomerIdForRole, getCustomerCode } from '../data/dataScope'
import { importCsvFile } from '../data/csvImportExport'
import {
  PRODUCT_COLUMNS,
  downloadProductTemplate,
  exportProducts,
  parseProducts,
} from '../data/importTemplates'
import { ImportTemplateLegend } from '../components/ui/ImportTemplateLegend'

const statusTabs = [
  { id: 'all', label: '全部' },
  { id: 'available', label: '可用' },
  { id: 'draft', label: '草稿' },
  { id: 'discarded', label: '废弃' },
  { id: 'reviewing', label: '审核中' },
]

interface ProductFilters {
  battery: TriState
  cert: TriState
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
  battery: 'all', cert: 'all', boxSpec: 'all',
  sku: '', skuMode: 'exact',
  customCode: '', customCodeMode: 'fuzzy',
  productName: '', productNameMode: 'fuzzy',
  outerBarcode: '',
  weightMin: '', weightMax: '', valueMin: '', valueMax: '',
}

type BatchChoice = 'keep' | 'yes' | 'no'

interface BatchDraft {
  hasBattery: BatchChoice
  certUploaded: BatchChoice
  hasBoxSpec: BatchChoice
  productStatus: Product['productStatus'] | 'keep'
}

const defaultBatchDraft: BatchDraft = {
  hasBattery: 'keep',
  certUploaded: 'keep',
  hasBoxSpec: 'keep',
  productStatus: 'keep',
}

function Modal({
  open, onClose, title, desc, children, footer, width = 'max-w-3xl',
}: {
  open: boolean
  onClose: () => void
  title: string
  desc?: string
  children: React.ReactNode
  footer?: React.ReactNode
  width?: string
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-slate-900/35 backdrop-blur-[2px]" />
      <div className={`relative flex max-h-[88vh] w-full ${width} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`}>
        <div className="flex items-start justify-between border-b border-border-light px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
            {desc && <p className="mt-1 text-xs text-text-muted">{desc}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-text-muted hover:bg-surface-muted hover:text-text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border-light bg-surface-muted/40 px-6 py-4">{footer}</div>}
      </div>
    </div>
  )
}

function readImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(`读取图片 ${file.name} 失败`))
    reader.readAsDataURL(file)
  })
}

function displaySku(p: Product) {
  return getPrimaryPlatformBarcode(p.internalSku) ?? getCustomerSkuDisplay(p)
}

function applyProductFilters(list: Product[], f: ProductFilters, tab: string) {
  return list.filter(p => {
    if (tab !== 'all' && p.productStatus !== tab) return false
    if (!matchTriState(p.hasBattery, f.battery)) return false
    if (!matchTriState(p.certUploaded, f.cert)) return false
    if (!matchTriState(p.hasBoxSpec, f.boxSpec)) return false
    const skuVal = `${displaySku(p)} ${p.internalSku}`
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
  const { role } = useRole()
  const products = useProducts()
  const [tab, setTab] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState<ProductFilters>(defaultFilters)
  const [applied, setApplied] = useState<ProductFilters>(defaultFilters)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [warningOpen, setWarningOpen] = useState(false)
  const [warningQty, setWarningQty] = useState(() => {
    const saved = Number(window.localStorage.getItem('oms-product-warning-qty'))
    return Number.isFinite(saved) && saved >= 0 ? saved : 10
  })
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchDraft, setBatchDraft] = useState<BatchDraft>(defaultBatchDraft)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const myProducts = useMemo(
    () => dataScope.scopeProducts(products),
    [dataScope, products],
  )

  const filtered = useMemo(() => applyProductFilters(myProducts, applied, tab), [myProducts, applied, tab])
  const selectedProducts = useMemo(
    () => myProducts.filter(product => selected.has(product.id)),
    [myProducts, selected],
  )
  const warningScopeProducts = useMemo(
    () => [...(selectedProducts.length > 0 ? selectedProducts : myProducts)]
      .sort((a, b) => a.availableQty - b.availableQty),
    [myProducts, selectedProducts],
  )
  const warningTriggeredCount = useMemo(
    () => warningScopeProducts.filter(product => product.availableQty <= warningQty).length,
    [warningScopeProducts, warningQty],
  )

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  const tabCounts = useMemo(() => {
    const base = applyProductFilters(myProducts, applied, 'all')
    return {
      all: base.length,
      available: base.filter(p => p.productStatus === 'available').length,
      draft: base.filter(p => p.productStatus === 'draft').length,
      discarded: base.filter(p => p.productStatus === 'discarded').length,
      reviewing: base.filter(p => p.productStatus === 'reviewing').length,
    }
  }, [myProducts, applied])

  const setDraftField = <K extends keyof ProductFilters>(key: K, value: ProductFilters[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  const handleQuery = () => {
    setApplied({ ...draft })
    setPage(1)
  }

  const handleImportProducts = async () => {
    try {
      const customerId = getCustomerIdForRole(role) ?? undefined
      const customerCode = getCustomerCode(customerId)
      const { data, errors } = await importCsvFile(
        PRODUCT_COLUMNS,
        records => parseProducts(records, customerId),
      )
      if (errors.length > 0) {
        window.alert(`导入失败：\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? `\n…共 ${errors.length} 条` : ''}`)
        return
      }
      if (data.length === 0) {
        window.alert('未解析到有效产品，请使用最新模板')
        return
      }
      const result = await importProducts(data, { customerCode, customerId })
      if (!result.ok) {
        window.alert(result.error)
        return
      }
      window.alert(`已导入 ${result.count} 个产品（待审核）`)
      setTab('reviewing')
    } catch (err) {
      notifyIfUserError(err, '导入失败')
    }
  }

  const handleExportAll = () => exportProducts(filtered)
  const handleExportSelected = () => {
    const picked = filtered.filter(p => selected.has(p.id))
    if (picked.length === 0) {
      window.alert('请先勾选要导出的产品')
      return
    }
    exportProducts(picked)
  }

  const toggleAll = () => {
    const allFilteredSelected = filtered.length > 0 && filtered.every(product => selected.has(product.id))
    setSelected(prev => {
      const next = new Set(prev)
      filtered.forEach(product => allFilteredSelected ? next.delete(product.id) : next.add(product.id))
      return next
    })
  }

  const ensureSelected = (action: string) => {
    if (selectedProducts.length > 0) return true
    window.alert(`请先勾选要${action}的产品`)
    return false
  }

  const printBarcodes = async (items = selectedProducts) => {
    if (items.length === 0) {
      window.alert('请先勾选要打印条码的产品')
      return
    }
    const inputs = items.map(product => ({
      code: product.internalSku.trim() || displaySku(product),
      copies: 1,
    })).filter(item => item.code)
    await printBarcodeLabels(inputs, 'SKU 标签')
  }

  const handleBatchImages = async (files: FileList | null) => {
    if (!files?.length || selectedProducts.length === 0) return
    const picked = Array.from(files)
    if (picked.length !== 1 && picked.length !== selectedProducts.length) {
      window.alert(`请选择 1 张图片应用到全部产品，或选择 ${selectedProducts.length} 张图片与已选产品逐一对应`)
      if (imageInputRef.current) imageInputRef.current.value = ''
      return
    }
    try {
      const dataUrls = await Promise.all(picked.map(readImage))
      const imageById = new Map(selectedProducts.map((product, index) => [
        product.id,
        dataUrls.length === 1 ? dataUrls[0] : dataUrls[index],
      ]))
      const count = await updateLocalProducts(selected, product => ({ image: imageById.get(product.id) || product.image }))
      window.alert(`已更新 ${count} 个产品的图片`)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '图片读取失败')
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = ''
    }
  }

  const deleteBatchImages = async () => {
    if (!ensureSelected('删除图片')) return
    if (!window.confirm(`确认删除已选 ${selectedProducts.length} 个产品的图片？`)) return
    try {
      const count = await updateLocalProducts(selected, { image: '' })
      window.alert(`已删除 ${count} 个产品的图片`)
    } catch (error) {
      window.alert(`删除图片失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const openBatchUpdate = () => {
    if (!ensureSelected('批量更新')) return
    setBatchDraft(defaultBatchDraft)
    setBatchOpen(true)
  }

  const saveBatchUpdate = async () => {
    if (batchDraft.productStatus === 'discarded'
      && !window.confirm(`确认将已选 ${selectedProducts.length} 个产品移入“废弃”？产品数据会保留，可在废弃标签中查看。`)) {
      return
    }
    const booleanValue = (value: BatchChoice, current: boolean) => value === 'keep' ? current : value === 'yes'
    try {
      const count = await updateLocalProducts(selected, product => ({
        hasBattery: booleanValue(batchDraft.hasBattery, product.hasBattery),
        certUploaded: booleanValue(batchDraft.certUploaded, product.certUploaded),
        hasBoxSpec: booleanValue(batchDraft.hasBoxSpec, product.hasBoxSpec),
        productStatus: batchDraft.productStatus === 'keep' ? product.productStatus : batchDraft.productStatus,
      }))
      setBatchOpen(false)
      window.alert(`已更新 ${count} 个产品${batchDraft.productStatus === 'discarded' ? '，可在“废弃”标签查看' : ''}`)
    } catch (error) {
      window.alert(`批量更新失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const saveWarningQty = () => {
    if (!Number.isFinite(warningQty) || warningQty < 0) {
      window.alert('预警阈值必须是大于或等于 0 的数字')
      return
    }
    window.localStorage.setItem('oms-product-warning-qty', String(warningQty))
    setWarningOpen(false)
  }

  const canApproveProduct = (product: Product) =>
    product.productStatus === 'draft'
    || product.productStatus === 'reviewing'

  const handleApproveProducts = async (productIds: string[]) => {
    const targets = myProducts.filter(product => productIds.includes(product.id) && canApproveProduct(product))
    if (targets.length === 0) {
      window.alert('没有可审核的产品（仅草稿或审核中状态可审核）')
      return
    }
    if (!window.confirm(`确认审核通过 ${targets.length} 个产品？通过后产品将移到“可用”标签。`)) return
    try {
      const count = await approveProducts(targets.map(product => product.id))
      window.alert(`已审核通过 ${count} 个产品，可在“可用”标签查看`)
      setTab('available')
      setPage(1)
    } catch (error) {
      window.alert(`审核失败，状态已恢复：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleApproveSelected = () => {
    if (!ensureSelected('审核')) return
    void handleApproveProducts(selectedProducts.map(product => product.id))
  }

  const handleDiscardProduct = async (product: Product) => {
    if (product.productStatus === 'discarded') {
      window.alert('该产品已在“废弃”标签中')
      return
    }
    if (!window.confirm(`确认将 ${displaySku(product)} 移入“废弃”？产品数据不会被删除。`)) return
    try {
      await updateLocalProducts([product.id], { productStatus: 'discarded' })
      window.alert('产品已移入“废弃”标签')
    } catch (error) {
      window.alert(`操作失败，产品状态已恢复：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <div className="page-shell">
      <PageHeader title="我的商品" desc={dataScope.isAdmin ? '全平台 SKU 主数据（含货盘池未激活商品）' : 'SKU 主数据、申报信息、规格尺寸与绑码状态'} />

      <ImportTemplateLegend columns={PRODUCT_COLUMNS} />

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
              <TriToggle label="上传证书" value={draft.cert} onChange={v => setDraftField('cert', v)} />
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
          <Button variant="toolbar" size="sm" onClick={handleApproveSelected}>审核</Button>
          <Button variant="toolbar" size="sm" onClick={() => setWarningOpen(true)}>预警库存</Button>
          <Button variant="toolbar" size="sm" onClick={() => void printBarcodes()}><Printer className="h-3.5 w-3.5" /> 打印条码</Button>
          <DropdownBtn variant="toolbar" label="批量" items={[
            {
              label: '批量上传图片',
              onClick: () => {
                if (ensureSelected('上传图片')) imageInputRef.current?.click()
              },
            },
            { label: '批量删除图片', onClick: deleteBatchImages },
            { label: '批量打印条码', onClick: () => void printBarcodes() },
            { label: '批量更新产品属性', onClick: openBatchUpdate },
          ]} />
          <Button variant="toolbar" size="sm" onClick={downloadProductTemplate}><Download className="h-3.5 w-3.5" /> 下载导入模板</Button>
          <DropdownBtn variant="toolbar" label="导入/导出" items={[
            { label: '导入产品', onClick: () => void handleImportProducts() },
            { label: '导出全部', onClick: handleExportAll },
            { label: '导出选中', onClick: handleExportSelected },
            { label: '下载导入模板', onClick: downloadProductTemplate },
          ]} />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={event => void handleBatchImages(event.target.files)}
          />
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
              <th>上传证书</th>
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
                    {displaySku(p)}
                  </Link>
                  <div className="mt-1.5 flex gap-1.5">
                    <Link to={`/products/${p.id}/edit`} className="rounded p-0.5 text-primary-500 hover:bg-primary-50" title="管理图片"><Image className="h-3.5 w-3.5" /></Link>
                    <button type="button" onClick={() => void handleDiscardProduct(p)} className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-500" title="移入废弃"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
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
                <td className="table-cell text-xs">{p.certUploaded ? <span className="text-emerald-600">是</span> : <span className="text-text-muted">否</span>}</td>
                <td className="table-cell">
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    <Link to={`/products/${p.id}/edit`} className="inline-flex items-center gap-0.5 font-medium text-primary-600 hover:underline"><Pencil className="h-3 w-3" /> 编辑</Link>
                    {canApproveProduct(p) && (
                      <>
                        <span className="text-text-muted">|</span>
                        <button
                          type="button"
                          onClick={() => void handleApproveProducts([p.id])}
                          className="inline-flex items-center gap-0.5 font-medium text-emerald-600 hover:underline"
                        >
                          审核
                        </button>
                      </>
                    )}
                    <span className="text-text-muted">|</span>
                    <Link to={`/products/new?copy=${encodeURIComponent(p.id)}`} className="inline-flex items-center gap-0.5 font-medium text-primary-600 hover:underline"><Copy className="h-3 w-3" /> 复制</Link>
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

      <Modal
        open={warningOpen}
        onClose={() => setWarningOpen(false)}
        title="预警库存"
        desc="可售库存低于或等于阈值的产品会出现在预警清单中。"
        footer={(
          <>
            <Button variant="secondary" size="sm" onClick={() => setWarningOpen(false)}>取消</Button>
            <Button size="sm" onClick={saveWarningQty}>保存阈值</Button>
          </>
        )}
      >
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
            <div>
              <p className="text-sm font-semibold text-amber-900">
                显示 {warningScopeProducts.length} 个 SKU，其中 {warningTriggeredCount} 个触发预警
              </p>
              <p className="mt-1 text-xs text-amber-700">
                {selectedProducts.length > 0 ? '当前显示已勾选的全部 SKU。' : '未勾选 SKU，当前显示全部商品。'}阈值保存在当前浏览器。
              </p>
            </div>
          </div>
          <label className="w-40 text-xs font-medium text-text-secondary">
            预警阈值
            <input
              type="number"
              min="0"
              step="1"
              value={warningQty}
              onChange={event => setWarningQty(Number(event.target.value))}
              className={`${inputCls} mt-1 bg-white`}
            />
          </label>
        </div>
        <div className="overflow-hidden rounded-xl border border-border-light">
          <Table>
            <thead className="table-head">
              <tr><th>SKU</th><th>产品</th><th>可售库存</th><th>锁定库存</th><th>状态</th><th>操作</th></tr>
            </thead>
            <tbody className="table-body">
              {warningScopeProducts.map(product => {
                const warning = product.availableQty <= warningQty
                return (
                <tr key={product.id} className="table-row">
                  <td className="table-cell"><MonoCode>{displaySku(product)}</MonoCode></td>
                  <td className="table-cell text-sm">{product.name}</td>
                  <td className={`table-cell font-semibold ${warning ? 'text-red-600' : 'text-emerald-600'}`}>{product.availableQty}</td>
                  <td className="table-cell">{product.lockedQty}</td>
                  <td className="table-cell">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${warning ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
                      {warning ? '库存预警' : '正常'}
                    </span>
                  </td>
                  <td className="table-cell"><Link to={`/products/${product.id}`} onClick={() => setWarningOpen(false)} className="text-xs font-medium text-primary-600 hover:underline">查看产品</Link></td>
                </tr>
                )
              })}
              {warningScopeProducts.length === 0 && (
                <tr><td colSpan={6} className="table-cell py-10 text-center text-sm text-text-muted">暂无 SKU</td></tr>
              )}
            </tbody>
          </Table>
        </div>
      </Modal>

      <Modal
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        title="批量更新产品属性"
        desc={`将更新已选 ${selectedProducts.length} 个产品；选择“保持不变”的字段不会被修改。`}
        width="max-w-xl"
        footer={(
          <>
            <Button variant="secondary" size="sm" onClick={() => setBatchOpen(false)}>取消</Button>
            <Button size="sm" onClick={saveBatchUpdate}>确认更新</Button>
          </>
        )}
      >
        <div className="space-y-4">
          {([
            ['hasBattery', '含电池'],
            ['certUploaded', '已上传证书'],
            ['hasBoxSpec', '已有产品箱规'],
          ] as const).map(([key, label]) => (
            <label key={key} className="block text-xs font-medium text-text-secondary">
              {label}
              <select value={batchDraft[key]} onChange={event => setBatchDraft(prev => ({ ...prev, [key]: event.target.value as BatchChoice }))} className={`${inputCls} mt-1`}>
                <option value="keep">保持不变</option>
                <option value="yes">是</option>
                <option value="no">否</option>
              </select>
            </label>
          ))}
          <label className="block text-xs font-medium text-text-secondary">
            产品状态
            <select value={batchDraft.productStatus} onChange={event => setBatchDraft(prev => ({ ...prev, productStatus: event.target.value as BatchDraft['productStatus'] }))} className={`${inputCls} mt-1`}>
              <option value="keep">保持不变</option>
              {statusTabs.filter(item => item.id !== 'all').map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
        </div>
      </Modal>
    </div>
  )
}
