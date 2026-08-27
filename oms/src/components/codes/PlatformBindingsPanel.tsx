import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Upload, Trash2, Settings } from 'lucide-react'
import {
  Button, Card, MonoCode, Tabs, Table, TableFooter,
} from '../ui'
import { DropdownBtn } from '../ui/filters'
import { inputCls } from '../ui/filters'
import PlatformBindingModal, { CopyBarcodeButton, type BindingFormState } from '../platform/PlatformBindingModal'
import {
  type PlatformSkuMapping,
  PLATFORM_BINDING_STATUS_LABELS,
  STOCK_SOURCE_LABELS,
} from '../../data/mockData'
import {
  setPlatformSkuMappings,
  usePlatformSkuMappings,
  useStores,
} from '../../data/entityStore'
import { apiDelete, apiPut } from '../../api/client'
import { notifyIfUserError } from '../../utils/userNotify'
import {
  filterBindingsByTab,
  applyPlatformBindingFilters,
  bindingTabCounts,
  defaultPlatformBindingFilters,
  type PlatformBindingTab,
  type PlatformBindingFilters,
} from '../../data/platformBindingUtils'
import { AdminCustomerFilter, AdminCustomerCell } from '../admin/AdminCustomerFilter'
import { useDataScope } from '../../auth/useDataScope'
import { useRole } from '../../auth/RoleContext'
import { importCsvFile } from '../../data/csvImportExport'
import {
  PLATFORM_BINDING_COLUMNS,
  downloadPlatformBindingTemplate,
  parsePlatformBindings,
} from '../../data/importTemplates'
import { ImportTemplateLegend } from '../ui/ImportTemplateLegend'

const STATUS_TABS: { id: PlatformBindingTab; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'unmapped', label: '待绑定' },
  { id: 'active', label: '已绑定' },
  { id: 'barcode_mismatch', label: '条码不一致' },
  { id: 'pending_review', label: '待审核' },
]

function statusBadge(status: PlatformSkuMapping['status']) {
  const map: Record<string, string> = {
    unmapped: 'bg-amber-100 text-amber-800',
    active: 'bg-emerald-100 text-emerald-800',
    pending_review: 'bg-blue-100 text-blue-800',
    barcode_mismatch: 'bg-red-100 text-red-800',
    deprecated: 'bg-slate-100 text-slate-600',
  }
  return map[status] ?? 'bg-slate-100 text-slate-600'
}

export default function PlatformBindingsPanel() {
  const { can, role } = useRole()
  const dataScope = useDataScope()
  const canWrite = can('platform:write')
  const canApprove = can('code:approve')
  const mappings = usePlatformSkuMappings()
  const stores = useStores()
  const [searchParams] = useSearchParams()

  const [list, setList] = useState<PlatformSkuMapping[]>(() => [...mappings])
  const [tab, setTab] = useState<PlatformBindingTab>('all')
  const [filters, setFilters] = useState<PlatformBindingFilters>(defaultPlatformBindingFilters)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<PlatformSkuMapping | null>(null)
  const [queryPrefill, setQueryPrefill] = useState<Partial<BindingFormState> | undefined>()
  const handledPrefill = useRef('')

  useEffect(() => {
    setList([...mappings])
  }, [mappings])

  useEffect(() => {
    const barcode = searchParams.get('barcode')?.trim() || ''
    const title = searchParams.get('title')?.trim() || ''
    if (!barcode || handledPrefill.current === barcode) return
    handledPrefill.current = barcode
    setFilters(previous => ({
      ...previous,
      barcode,
      platformTitle: title,
    }))
    if (canWrite) {
      const matches = dataScope.scope(mappings).filter(mapping =>
        mapping.platform === 'Takealot' && mapping.platformBarcode === barcode)
      const active = matches.find(mapping => mapping.status === 'active' && mapping.lines.some(line => line.internalSku))
      if (active) return
      setEditing(matches.length === 1 ? matches[0] : null)
      setQueryPrefill({
        platform: 'Takealot',
        platformBarcode: barcode,
        platformTitle: title,
      })
      setModalOpen(true)
    }
  }, [searchParams, canWrite, dataScope, mappings])

  const persistList = async (next: PlatformSkuMapping[]) => {
    const before = list
    setList(next)
    setPlatformSkuMappings(next)
    try {
      await apiPut('/platform-sku-mappings', next)
      return true
    } catch (error) {
      setList(before)
      setPlatformSkuMappings(before)
      window.alert(`保存失败，数据已恢复：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  const filtered = useMemo(() => {
    let rows = filterBindingsByTab(dataScope.scope(list), tab)
    rows = applyPlatformBindingFilters(rows, filters)
    return rows
  }, [list, tab, filters, dataScope])

  const counts = useMemo(() => bindingTabCounts(dataScope.scope(list)), [list, dataScope])

  const setFilter = <K extends keyof PlatformBindingFilters>(key: K, value: PlatformBindingFilters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const openCreate = () => {
    setEditing(null)
    setQueryPrefill(undefined)
    setModalOpen(true)
  }

  const openEdit = (row: PlatformSkuMapping) => {
    setEditing(row)
    setQueryPrefill(undefined)
    setModalOpen(true)
  }

  const handleSave = async (form: BindingFormState, prev: PlatformSkuMapping | null) => {
    const store = stores.find(s => s.id === form.storeId)
    const validLines = form.lines.filter(l => l.internalSku)
    const nextStatus = prev?.hasInventory && prev.status === 'active'
      ? 'pending_review' as const
      : validLines.length === 0
        ? 'unmapped' as const
        : 'active' as const

    let next: PlatformSkuMapping[]
    if (prev) {
      next = list.map(m => m.id === prev.id ? {
        ...m,
        customerId: dataScope.activeCustomerId ?? m.customerId,
        sellerId: store?.sellerId ?? m.sellerId,
        platform: form.platform,
        storeId: form.storeId,
        storeName: store?.name ?? m.storeName,
        platformSkuId: prev.platformSkuId || undefined,
        platformBarcode: form.platformBarcode,
        platformTitle: form.platformTitle,
        stockSource: form.stockSource,
        lines: validLines,
        status: nextStatus,
        syncSource: 'manual' as const,
        version: m.version + (nextStatus === 'pending_review' ? 1 : 0),
        updatedAt: '2026-07-08',
      } : m)
    } else {
      next = [...list, {
        id: `pb-${Date.now()}`,
        customerId: dataScope.activeCustomerId ?? undefined,
        sellerId: store?.sellerId,
        platform: form.platform,
        storeId: form.storeId,
        storeName: store?.name ?? '—',
        platformSkuId: undefined,
        platformBarcode: form.platformBarcode,
        platformTitle: form.platformTitle,
        lines: validLines,
        status: validLines.length ? 'active' : 'unmapped',
        stockSource: form.stockSource,
        syncSource: 'manual',
        version: 1,
        hasInventory: false,
        updatedAt: '2026-07-08',
      }]
    }
    if (await persistList(next)) {
      setModalOpen(false)
      setEditing(null)
    }
  }

  const handleDelete = async () => {
    if (selected.size === 0) return
    if (!window.confirm(`确认删除已选 ${selected.size} 条平台绑定？此操作不可恢复。`)) return
    const before = list
    const next = list.filter(m => !selected.has(m.id))
    setList(next)
    setPlatformSkuMappings(next)
    try {
      await Promise.all([...selected].map(id =>
        apiDelete(`/platform-sku-mappings/${encodeURIComponent(id)}`),
      ))
      setSelected(new Set())
      window.alert(`已删除 ${selected.size} 条平台绑定`)
    } catch (error) {
      setList(before)
      setPlatformSkuMappings(before)
      window.alert(`删除失败，数据已恢复：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleImportBindings = async () => {
    try {
      const { data, errors } = await importCsvFile(
        PLATFORM_BINDING_COLUMNS,
        records => parsePlatformBindings(records, stores),
      )
      if (errors.length > 0) {
        window.alert(`导入失败：\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? `\n…共 ${errors.length} 条` : ''}`)
        return
      }
      if (data.length === 0) {
        window.alert('未解析到有效绑定，请使用最新模板')
        return
      }

      const imported: PlatformSkuMapping[] = data.map(row => ({
        id: `pb-import-${Date.now()}-${row.platformBarcode}`,
        platform: row.platform,
        storeId: row.storeId,
        storeName: row.storeName,
        platformSkuId: undefined,
        platformBarcode: row.platformBarcode,
        platformTitle: row.platformTitle,
        lines: row.lines,
        status: row.lines.length ? 'active' : 'unmapped',
        stockSource: row.stockSource,
        syncSource: 'import',
        version: 1,
        hasInventory: false,
        updatedAt: '2026-07-08',
      }))

      if (await persistList([...imported, ...list])) {
        window.alert(`已导入 ${imported.length} 条平台绑定`)
      }
    } catch (err) {
      notifyIfUserError(err, '导入失败')
    }
  }

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map(r => r.id)))
  }

  if (role === 'catalog' && !dataScope.isAdmin) {
    return (
      <Card className="p-6 text-sm text-text-secondary">
        <p className="font-medium text-text-primary">货盘客户通常无需绑定平台 SKU</p>
        <p className="mt-2">请使用货盘选品与内部 SKU 履约。如需开通电商业务，请联系管理员将账号升级为混合客户。</p>
      </Card>
    )
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          {dataScope.isAdmin
            ? '全平台商品条码与仓库 SKU 映射'
            : '平台商品条码与仓库 SKU 的映射，订单同步后据此扣减库存'}
        </p>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={openCreate}><Plus className="h-3.5 w-3.5" /> 新增</Button>
            <DropdownBtn label="导入平台商品" items={[
              { label: 'Excel 批量导入', onClick: () => void handleImportBindings() },
              { label: '下载导入模板', onClick: downloadPlatformBindingTemplate },
            ]} />
          </div>
        )}
      </div>

      <ImportTemplateLegend columns={PLATFORM_BINDING_COLUMNS} />

      <div className="mb-4 flex flex-wrap gap-2">
        {canWrite && (
          <>
            <Button variant="toolbar" size="sm" onClick={() => void handleImportBindings()}>
              <Upload className="h-3.5 w-3.5" /> 导入平台商品
            </Button>
            <Button variant="toolbar" size="sm" disabled={selected.size === 0} onClick={() => void handleDelete()}>
              <Trash2 className="h-3.5 w-3.5" /> 删除
            </Button>
          </>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        {dataScope.isAdmin && <div className="w-56"><AdminCustomerFilter scope={dataScope} /></div>}
      </div>

      <div className="mb-4 overflow-x-auto">
        <Tabs
          tabs={STATUS_TABS.map(t => ({ id: t.id, label: t.label, count: counts[t.id] }))}
          active={tab}
          onChange={id => setTab(id as PlatformBindingTab)}
        />
      </div>

      <Card className="overflow-hidden">
        <Table>
          <thead className="table-head">
            <tr>
              <th className="w-10">
                <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} className="rounded border-border" />
              </th>
              <th className="text-primary-700">平台名称</th>
              {dataScope.isAdmin && <th>客户代码</th>}
              <th className="text-primary-700">平台商品条码</th>
              <th className="min-w-[180px] text-primary-700">平台商品名称</th>
              <th>仓库商品编码</th>
              <th>仓库商品名称</th>
              <th>简称</th>
              <th>库存来源</th>
              <th>绑定状态</th>
              <th>同步来源</th>
              <th>操作</th>
            </tr>
            <tr className="bg-surface-muted/40">
              <th />
              <th><input className={inputCls} placeholder="筛选" value={filters.platform} onChange={e => setFilter('platform', e.target.value)} /></th>
              {dataScope.isAdmin && <th />}
              <th><input className={inputCls} placeholder="筛选" value={filters.barcode} onChange={e => setFilter('barcode', e.target.value)} /></th>
              <th><input className={inputCls} placeholder="筛选" value={filters.platformTitle} onChange={e => setFilter('platformTitle', e.target.value)} /></th>
              <th><input className={inputCls} placeholder="筛选" value={filters.warehouseSku} onChange={e => setFilter('warehouseSku', e.target.value)} /></th>
              <th><input className={inputCls} placeholder="筛选" value={filters.warehouseName} onChange={e => setFilter('warehouseName', e.target.value)} /></th>
              <th colSpan={5} />
            </tr>
          </thead>
          <tbody className="table-body">
            {filtered.length === 0 ? (
              <tr><td colSpan={dataScope.isAdmin ? 12 : 11} className="table-cell py-10 text-center text-xs text-text-muted">暂无数据</td></tr>
            ) : filtered.flatMap(row => {
              if (row.lines.length === 0) {
                return [(
                  <tr key={row.id} className="table-row">
                    <td className="table-cell">
                      <input type="checkbox" checked={selected.has(row.id)} onChange={() => setSelected(prev => {
                        const next = new Set(prev)
                        next.has(row.id) ? next.delete(row.id) : next.add(row.id)
                        return next
                      })} className="rounded border-border" />
                    </td>
                    <td className="table-cell text-xs font-semibold text-primary-700">{row.platform}</td>
                    <AdminCustomerCell customerId={row.customerId} scope={dataScope} />
                    <td className="table-cell text-xs text-primary-700">
                      <span className="inline-flex items-center font-mono">{row.platformBarcode}<CopyBarcodeButton value={row.platformBarcode} /></span>
                    </td>
                    <td className="table-cell max-w-[200px] truncate text-xs text-primary-700" title={row.platformTitle}>{row.platformTitle}</td>
                    <td className="table-cell text-xs text-text-muted" colSpan={3}>— 待绑定仓库 SKU —</td>
                    <td className="table-cell text-xs">{STOCK_SOURCE_LABELS[row.stockSource]}</td>
                    <td className="table-cell"><span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${statusBadge(row.status)}`}>{PLATFORM_BINDING_STATUS_LABELS[row.status]}</span></td>
                    <td className="table-cell text-xs text-text-muted">{row.syncSource === 'api' ? '平台同步' : row.syncSource === 'import' ? '导入' : '手工'}</td>
                    <td className="table-cell">
                      {canWrite && <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>绑定</Button>}
                    </td>
                  </tr>
                )]
              }
              return row.lines.map((line, lineIdx) => (
                <tr key={`${row.id}-${lineIdx}`} className="table-row">
                  {lineIdx === 0 && (
                    <>
                      <td className="table-cell align-top" rowSpan={row.lines.length}>
                        <input type="checkbox" checked={selected.has(row.id)} onChange={() => setSelected(prev => {
                          const next = new Set(prev)
                          next.has(row.id) ? next.delete(row.id) : next.add(row.id)
                          return next
                        })} className="rounded border-border" />
                      </td>
                      <td className="table-cell align-top text-xs font-semibold text-primary-700" rowSpan={row.lines.length}>{row.platform}</td>
                      <AdminCustomerCell customerId={row.customerId} scope={dataScope} rowSpan={row.lines.length} />
                      <td className="table-cell align-top text-xs text-primary-700" rowSpan={row.lines.length}>
                        <span className="inline-flex items-center font-mono">{row.platformBarcode}<CopyBarcodeButton value={row.platformBarcode} /></span>
                      </td>
                      <td className="table-cell align-top max-w-[200px] truncate text-xs text-primary-700" rowSpan={row.lines.length} title={row.platformTitle}>{row.platformTitle}</td>
                    </>
                  )}
                  <td className="table-cell"><MonoCode>{line.internalSku}</MonoCode>{row.lines.length > 1 && <span className="ml-1 text-[10px] text-violet-600">×{line.qty}</span>}</td>
                  <td className="table-cell text-xs">{line.warehouseName}</td>
                  <td className="table-cell text-xs text-text-muted">{line.shortName ?? '—'}</td>
                  {lineIdx === 0 && (
                    <>
                      <td className="table-cell align-top text-xs" rowSpan={row.lines.length}>{STOCK_SOURCE_LABELS[row.stockSource]}</td>
                      <td className="table-cell align-top" rowSpan={row.lines.length}>
                        <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${statusBadge(row.status)}`}>{PLATFORM_BINDING_STATUS_LABELS[row.status]}</span>
                      </td>
                      <td className="table-cell align-top text-xs text-text-muted" rowSpan={row.lines.length}>{row.syncSource === 'api' ? '平台同步' : row.syncSource === 'import' ? '导入' : '手工'}</td>
                      <td className="table-cell align-top" rowSpan={row.lines.length}>
                        {canWrite && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(row)} title="编辑">
                            <Settings className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canApprove && row.status === 'pending_review' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (!window.confirm(`确认审核通过平台条码 ${row.platformBarcode}？`)) return
                              void persistList(list.map(m => m.id === row.id ? { ...m, status: 'active' } : m))
                            }}
                          >
                            审核
                          </Button>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))
            })}
          </tbody>
        </Table>
        <TableFooter total={filtered.length} />
      </Card>

      <PlatformBindingModal
        open={modalOpen}
        editing={editing}
        customerId={dataScope.activeCustomerId ?? undefined}
        initialValues={queryPrefill}
        onClose={() => { setModalOpen(false); setEditing(null); setQueryPrefill(undefined) }}
        onSave={handleSave}
      />
    </>
  )
}
