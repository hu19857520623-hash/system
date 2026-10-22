
import { userFacingError } from '../utils/userFacingError'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { TableActionLink, actionLinkClass } from '../components/outbound/PodReceiptModals'
import {
  Badge, Button, Card, PageHeader, MonoCode, Tabs, Table, TableFooter, Select, StatCard,
} from '../components/ui'
import InboundDetailDrawer from '../components/inbound/InboundDetailDrawer'
import { InboundPrintLabelMenu } from '../components/inbound/InboundPrintLabelMenu'
import {
  SearchField, FilterActions, DropdownBtn, inputCls, matchText, type SearchMode,
} from '../components/ui/filters'
import {
  InboundOrder, DELIVERY_METHOD_LABELS, STOCK_SOURCE_LABELS, statusLabels, warehouseFilterOptions, warehouseLabel,
  CUSTOMER_INBOUND_TYPES, customerInboundTypeLabel, customerInboundStockLabel,
} from '../data/mockData'
import { useInboundOrders } from '../data/entityStore'
import { useDataScope } from '../auth/useDataScope'
import { AdminCustomerFilter, AdminCustomerCell } from '../components/admin/AdminCustomerFilter'
import { useRole } from '../auth/RoleContext'
import { getCustomerIdForRole } from '../data/dataScope'
import { canEditInboundOrder, canVoidInboundOrder, canReorderInboundOrder, refreshInboundsFromErp, voidInboundOrder, withdrawInboundOrder, inboundMutationFailure } from '../data/inboundStore'
import { addInboundOrdersOrThrow, getInboundOrdersSnapshot } from '../data/entityStore'
import { buildImportedInboundDrafts } from '../data/inboundDraftImport'
import { importCsvFile } from '../data/csvImportExport'
import {
  INBOUND_ORDER_COLUMNS,
  downloadInboundOrderTemplate,
  exportInboundOrders,
  parseInboundOrders,
} from '../data/importTemplates'
import { ImportTemplateLegend } from '../components/ui/ImportTemplateLegend'
import { notifyIfUserError, notifySuccess, notifyError, notifyInfo } from '../utils/userNotify'

const statusTabs = [
  { id: 'all', label: '全部' },
  { id: 'draft', label: '草稿' },
  { id: 'on_the_way', label: '在途' },
  { id: 'receiving', label: '收货中' },
  { id: 'completed', label: '收货完成' },
  { id: 'shelved', label: '上架完成' },
  { id: 'exception', label: '异常' },
  { id: 'voided', label: '作废' },
]

interface InboundFilters {
  inboundNo: string
  inboundNoMode: SearchMode
  referenceNo: string
  referenceNoMode: SearchMode
  sku: string
  skuMode: SearchMode
  trackingNo: string
  warehouse: string
  inboundType: string
  dateFrom: string
  dateTo: string
}

const defaultFilters: InboundFilters = {
  inboundNo: '', inboundNoMode: 'fuzzy',
  referenceNo: '', referenceNoMode: 'fuzzy',
  sku: '', skuMode: 'fuzzy',
  trackingNo: '', warehouse: 'all', inboundType: 'all',
  dateFrom: '', dateTo: '',
}

function filterByTab(list: InboundOrder[], tab: string) {
  if (tab === 'all') return list
  if (tab === 'completed') return list.filter(o => ['partial', 'completed'].includes(o.status))
  return list.filter(o => o.status === tab)
}

function applyInboundFilters(list: InboundOrder[], f: InboundFilters, forCustomer: boolean) {
  return list.filter(o => {
    if (f.warehouse !== 'all' && o.warehouse !== f.warehouse) return false
    if (f.inboundType !== 'all') {
      const inboundType = forCustomer ? customerInboundTypeLabel(o.inboundType) : o.inboundType
      if (inboundType !== f.inboundType) return false
    }
    if (!matchText(o.inboundNo, f.inboundNo, f.inboundNoMode)) return false
    if (!matchText(o.referenceNo ?? '', f.referenceNo, f.referenceNoMode)) return false
    if (!matchText(o.skuHint ?? '', f.sku, f.skuMode)) return false
    if (f.trackingNo && !(o.trackingNo ?? '').includes(f.trackingNo)) return false
    if (f.dateFrom && o.createdAt < f.dateFrom) return false
    if (f.dateTo && o.createdAt > f.dateTo) return false
    return true
  })
}

export default function InboundRecords() {
  const dataScope = useDataScope()
  const { role } = useRole()
  const inboundOrders = useInboundOrders()
  const scopedInbound = useMemo(() => dataScope.scopeInbound(inboundOrders), [dataScope, inboundOrders])
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') ?? 'all'
  const [tab, setTab] = useState(initialTab === 'submitted' ? 'on_the_way' : initialTab)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [draft, setDraft] = useState<InboundFilters>(defaultFilters)
  const [applied, setApplied] = useState<InboundFilters>(defaultFilters)
  const [detail, setDetail] = useState<InboundOrder | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [voiding, setVoiding] = useState(false)
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importFeedback, setImportFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const handleWithdraw = async (order: InboundOrder) => {
    if (!window.confirm(`确认撤回入库单 ${order.inboundNo}？仓库将停止收货，之后可在草稿中修改并重新提交。`)) return
    setWithdrawingId(order.id)
    try {
      const result = await withdrawInboundOrder(order)
      if (!result.ok) notifyError(result.error)
      else {
        if (detail?.id === order.id) setDetail(result.order)
        if (result.warning) notifyInfo(result.warning)
        else notifySuccess('已撤回为草稿，可修改后重新提交')
      }
    } catch (error) {
      notifyIfUserError(error, '撤回失败')
    } finally {
      setWithdrawingId(null)
    }
  }

  const syncFromErp = async () => {
    const customerId = getCustomerIdForRole(role)
    if (!customerId) {
      window.alert('请切换到客户角色后再同步')
      return
    }
    setSyncing(true)
    try {
      const n = await refreshInboundsFromErp(customerId)
      window.alert(`已从 ERP 同步 ${n} 条入库单状态`)
    } catch (err) {
      window.alert(userFacingError(err instanceof Error ? err.message : String(err)))
    } finally {
      setSyncing(false)
    }
  }

  const filtered = useMemo(() => {
    let list = scopedInbound
    list = filterByTab(list, tab)
    list = applyInboundFilters(list, applied, !dataScope.isAdmin)
    return list
  }, [tab, applied, scopedInbound, dataScope.isAdmin])

  const tabCounts = useMemo(() => ({
    all: scopedInbound.length,
    draft: scopedInbound.filter(o => o.status === 'draft').length,
    on_the_way: scopedInbound.filter(o => o.status === 'on_the_way').length,
    receiving: scopedInbound.filter(o => ['receiving', 'partial'].includes(o.status)).length,
    completed: scopedInbound.filter(o => ['partial', 'completed'].includes(o.status)).length,
    shelved: scopedInbound.filter(o => o.status === 'shelved').length,
    exception: scopedInbound.filter(o => o.status === 'exception').length,
    voided: scopedInbound.filter(o => o.status === 'voided').length,
  }), [scopedInbound])

  const setDraftField = <K extends keyof InboundFilters>(key: K, value: InboundFilters[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  const handleBulkImport = async () => {
    if (importing) return
    const customerId = dataScope.bindingCustomerId
    const customerCode = dataScope.getCustomerCode(customerId ?? undefined)
    if (!customerId || !customerCode || customerCode === '—') {
      setImportFeedback({ kind: 'err', text: '请先选择导入客户，再导入入库预约单' })
      return
    }
    setImporting(true)
    setImportFeedback(null)
    let savingImported = false
    try {
      const { data, errors } = await importCsvFile(INBOUND_ORDER_COLUMNS, parseInboundOrders)
      if (errors.length > 0) {
        setImportFeedback({ kind: 'err', text: `导入失败：\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? `\n…共 ${errors.length} 条` : ''}` })
        return
      }
      if (data.length === 0) {
        setImportFeedback({ kind: 'err', text: '未解析到有效预约单，请使用最新模板' })
        return
      }

      const orders = buildImportedInboundDrafts(data, {
        customerId, customerCode, existingNos: getInboundOrdersSnapshot().map(order => order.inboundNo),
      })
      savingImported = true
      await addInboundOrdersOrThrow(orders)
      setImportFeedback({ kind: 'ok', text: `已保存 ${orders.length} 张入库预约单（草稿），可在草稿列表继续编辑并提交` })
      setTab('draft')
    } catch (err) {
      if (err === 'cancelled' || (err instanceof Error && err.message === 'cancelled')) return
      const result = inboundMutationFailure(err)
      setImportFeedback({ kind: 'err', text: savingImported && result.uncertain
        ? '导入结果暂无法确认，请先点击“立即刷新”核对记录，请勿重复导入。' + userFacingError(err)
        : `导入未完成：${result.error}` })
    } finally {
      setImporting(false)
    }
  }

  const allVisibleSelected = filtered.length > 0 && filtered.every(o => selected.has(o.id))
  const selectedOrders = filtered.filter(o => selected.has(o.id))

  const toggleAll = () => {
    setSelected(prev => {
      if (filtered.every(o => prev.has(o.id))) return new Set()
      return new Set(filtered.map(o => o.id))
    })
  }

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleExportSelected = () => {
    if (selectedOrders.length === 0) {
      window.alert('请先勾选要导出的入库单')
      return
    }
    exportInboundOrders(selectedOrders)
  }

  const confirmVoid = (orders: InboundOrder[]) => {
    const labels = orders.map(o => o.inboundNo).slice(0, 8).join('、')
    const more = orders.length > 8 ? ` 等 ${orders.length} 张` : ''
    return window.confirm(`确认作废入库单 ${labels}${more}？作废后仓库不再收货，可在详情中确认后重新下单。`)
  }

  const handleVoidOrders = async (orders: InboundOrder[]) => {
    const targets = orders.filter(o => canVoidInboundOrder(o.status))
    if (targets.length === 0) {
      window.alert('选中的入库单均不可作废（仅草稿或在途可作废）')
      return
    }
    if (!confirmVoid(targets)) return
    setVoiding(true)
    const completed: InboundOrder[] = []
    const warnings: string[] = []
    try {
      for (const order of targets) {
        const result = await voidInboundOrder(order)
        if (!result.ok) {
          notifyError(`${completed.length ? `已作废 ${completed.length} 张；` : ''}${order.inboundNo}：${result.error}`)
          return
        }
        completed.push(result.order)
        if (result.warning) warnings.push(result.warning)
      }
      if (warnings.length) notifyInfo(warnings.join('\n'))
      else notifySuccess(targets.length === 1 ? `入库单 ${targets[0].inboundNo} 已作废` : `已作废 ${targets.length} 张入库单`)
    } catch (error) {
      notifyIfUserError(error, `作废未全部完成，已完成 ${completed.length} 张`)
    } finally {
      setSelected(prev => {
        const next = new Set(prev)
        for (const order of completed) next.delete(order.id)
        return next
      })
      if (detail && completed.some(o => o.id === detail.id)) setDetail(null)
      setVoiding(false)
    }
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="入库记录"
        desc={dataScope.isAdmin ? '全平台入库单，可按客户筛选' : '查看预约入库草稿，跟踪已提交单据的在途、收货与上架进度'}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={syncing} onClick={() => void syncFromErp()}>
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? '刷新中…' : '立即刷新'}
            </Button>
            <DropdownBtn label={importing ? '导入中…' : '导入/导出'} disabled={importing} items={[
              { label: '批量导入预约单', onClick: () => void handleBulkImport() },
              { label: '导出列表', onClick: () => exportInboundOrders(filtered) },
              { label: '导出选中', onClick: handleExportSelected },
              { label: '下载导入模板', onClick: downloadInboundOrderTemplate },
            ]} />
          </div>
        }
      />

      {importFeedback && <p role={importFeedback.kind === 'err' ? 'alert' : 'status'}
        className={`mb-4 whitespace-pre-wrap rounded-lg px-4 py-3 text-sm ${importFeedback.kind === 'err' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
        {importFeedback.text}
      </p>}

      <ImportTemplateLegend columns={INBOUND_ORDER_COLUMNS} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="草稿" value={tabCounts.draft} sub="未提交的预约单" />
        <StatCard label="在途" value={tabCounts.on_the_way} sub="货物发往海外仓" />
        <StatCard label="收货中" value={tabCounts.receiving} />
        <StatCard label="异常" value={tabCounts.exception} alert={tabCounts.exception > 0} />
        <StatCard label="作废" value={tabCounts.voided} sub="已取消，可重新下单" />
      </div>

      <div className="mb-4 overflow-x-auto">
        <Tabs
          tabs={statusTabs.map(t => ({
            id: t.id,
            label: t.label,
            count: tabCounts[t.id as keyof typeof tabCounts],
          }))}
          active={tab}
          onChange={setTab}
        />
      </div>

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {dataScope.isAdmin && <AdminCustomerFilter scope={dataScope} />}
          <SearchField label="预约单号" value={draft.inboundNo} onChange={v => setDraftField('inboundNo', v)} mode={draft.inboundNoMode} onModeChange={v => setDraftField('inboundNoMode', v)} />
          <SearchField label="参考号" value={draft.referenceNo} onChange={v => setDraftField('referenceNo', v)} mode={draft.referenceNoMode} onModeChange={v => setDraftField('referenceNoMode', v)} />
          <SearchField label="SKU" value={draft.sku} onChange={v => setDraftField('sku', v)} mode={draft.skuMode} onModeChange={v => setDraftField('skuMode', v)} />
          <Select label="目的仓库" value={draft.warehouse} onChange={v => setDraftField('warehouse', v)} options={warehouseFilterOptions()} />
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-border-light pt-3">
          <button type="button" onClick={() => setAdvancedOpen(v => !v)} className="text-xs font-medium text-primary-600 hover:underline">
            {advancedOpen ? '收起高级搜索' : '高级搜索'}
          </button>
          <FilterActions
            onQuery={() => setApplied({ ...draft })}
            onReset={() => { setDraft(defaultFilters); setApplied(defaultFilters) }}
          />
        </div>
        {advancedOpen && (
          <div className="mt-3 grid gap-3 border-t border-border-light pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-text-muted">物流单号</label>
              <input value={draft.trackingNo} onChange={e => setDraftField('trackingNo', e.target.value)} className={inputCls} />
            </div>
            <Select label="入库类型" value={draft.inboundType} onChange={v => setDraftField('inboundType', v)} options={[
              { value: 'all', label: '全部' },
              ...CUSTOMER_INBOUND_TYPES.map(type => ({ value: type, label: type })),
            ]} />
            <div>
              <label className="mb-1 block text-[11px] font-medium text-text-muted">创建日期从</label>
              <input type="date" value={draft.dateFrom} onChange={e => setDraftField('dateFrom', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-text-muted">创建日期至</label>
              <input type="date" value={draft.dateTo} onChange={e => setDraftField('dateTo', e.target.value)} className={inputCls} />
            </div>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        {selectedOrders.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-light bg-surface-muted/60 px-4 py-2.5">
            <p className="text-xs text-text-secondary">已选 {selectedOrders.length} 张入库单</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={handleExportSelected}>导出选中</Button>
              <Button
                variant="danger-outline"
                size="sm"
                disabled={voiding || selectedOrders.every(o => !canVoidInboundOrder(o.status))}
                onClick={() => void handleVoidOrders(selectedOrders)}
              >
                {voiding ? '作废中…' : '作废选中'}
              </Button>
            </div>
          </div>
        )}
        <Table>
          <thead className="table-head">
            <tr>
              <th className="w-10">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAll}
                  className="rounded border-border"
                  aria-label="全选入库单"
                />
              </th>
              <th>预约单号</th>
              {dataScope.isAdmin && <th>客户代码</th>}
              <th>目的仓</th>
              <th>入库类型</th>
              <th>交货方式</th>
              <th>库存来源</th>
              <th>预计到货</th>
              <th>跟踪号</th>
              <th>箱数</th>
              <th>总数量</th>
              <th>应收/实收</th>
              <th>状态</th>
              <th>创建日期</th>
              <th className="min-w-[120px] whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody className="table-body">
            {filtered.map(o => (
              <tr key={o.id} className="table-row">
                <td className="table-cell">
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    onChange={() => toggleOne(o.id)}
                    className="rounded border-border"
                    aria-label={`选择 ${o.inboundNo}`}
                  />
                </td>
                <td className="table-cell">
                  <Link to={`/inbound/records/${encodeURIComponent(o.id)}`} className="hover:underline" aria-label={`查看 ${o.inboundNo} 详情`}>
                    <MonoCode>{o.inboundNo}</MonoCode>
                  </Link>
                </td>
                <AdminCustomerCell customerId={o.customerId} scope={dataScope} />
                <td className="table-cell text-xs">{warehouseLabel(o.warehouse)}</td>
                <td className="table-cell text-xs">{dataScope.isAdmin ? o.inboundType : customerInboundTypeLabel(o.inboundType)}</td>
                <td className="table-cell text-xs">{DELIVERY_METHOD_LABELS[o.deliveryMethod]}</td>
                <td className="table-cell">
                  <span className={`text-[11px] font-semibold ${!dataScope.isAdmin || o.stockSource === 'owned' ? 'text-emerald-700' : 'text-violet-700'}`}>
                    {dataScope.isAdmin ? STOCK_SOURCE_LABELS[o.stockSource] : customerInboundStockLabel(o.stockSource)}
                  </span>
                </td>
                <td className="table-cell text-xs">{o.eta ?? '—'}</td>
                <td className="table-cell text-xs text-text-secondary">{o.trackingNo ?? '—'}</td>
                <td className="table-cell text-xs">{o.boxCount}</td>
                <td className="table-cell text-xs font-semibold">{o.totalQty}</td>
                <td className="table-cell text-xs"><span className="font-semibold">{o.receivedQty}</span><span className="text-text-muted"> / {o.totalQty}</span></td>
                <td className="table-cell"><Badge status={o.status} label={statusLabels[o.status]} /></td>
                <td className="table-cell text-xs text-text-muted">{o.createdAt}</td>
                <td className="table-cell align-top">
                  <div className="flex min-w-[72px] flex-col gap-0.5">
                    <Link to={`/inbound/records/${encodeURIComponent(o.id)}`} className={actionLinkClass()}>详情</Link>
                    <InboundPrintLabelMenu order={o} />
                    {canEditInboundOrder(o.status) && (
                      <Link to={`/inbound?edit=${encodeURIComponent(o.id)}`} className={actionLinkClass()}>
                        编辑
                      </Link>
                    )}
                    {o.status === 'on_the_way' && (
                      <TableActionLink onClick={() => void handleWithdraw(o)}>
                        {withdrawingId === o.id ? '撤回中…' : '撤回为草稿'}
                      </TableActionLink>
                    )}
                    {canVoidInboundOrder(o.status) && (
                      <TableActionLink onClick={() => void handleVoidOrders([o])}>
                        作废
                      </TableActionLink>
                    )}
                    {canReorderInboundOrder(o.status) && (
                      <TableActionLink onClick={() => setDetail(o)}>
                        重新下单
                      </TableActionLink>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <TableFooter total={filtered.length} />
      </Card>

      <InboundDetailDrawer
        order={detail}
        onClose={() => setDetail(null)}
        onOrderChanged={next => setDetail(next ?? null)}
      />
    </div>
  )
}
