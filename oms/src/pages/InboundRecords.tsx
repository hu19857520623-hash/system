import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Printer, RefreshCw } from 'lucide-react'
import {
  Badge, Button, Card, PageHeader, MonoCode, Tabs, Table, TableFooter, Select, StatCard,
} from '../components/ui'
import InboundDetailDrawer from '../components/inbound/InboundDetailDrawer'
import { INBOUND_DOWNLOAD_ITEMS } from '../data/customerShipFlows'
import { printInboundLabels, type InboundLabelKind } from '../data/inboundLabelPrint'
import {
  SearchField, FilterActions, DropdownBtn, inputCls, matchText, type SearchMode,
} from '../components/ui/filters'
import {
  InboundOrder, DELIVERY_METHOD_LABELS, STOCK_SOURCE_LABELS, statusLabels, warehouseFilterOptions, warehouseLabel,
} from '../data/mockData'
import { useInboundOrders } from '../data/entityStore'
import { useDataScope } from '../auth/useDataScope'
import { AdminCustomerFilter, AdminCustomerCell } from '../components/admin/AdminCustomerFilter'
import { useRole } from '../auth/RoleContext'
import { getCustomerIdForRole } from '../data/dataScope'
import { addInboundOrder, nextInboundNo, refreshInboundsFromErp } from '../data/inboundStore'
import { importCsvFile } from '../data/csvImportExport'
import {
  INBOUND_ORDER_COLUMNS,
  downloadInboundOrderTemplate,
  exportInboundOrders,
  parseInboundOrders,
} from '../data/importTemplates'
import { ImportTemplateLegend } from '../components/ui/ImportTemplateLegend'
import { todayDateInput } from '../data/fileUtils'
import type { StockSource } from '../data/mockData'

const statusTabs = [
  { id: 'all', label: '全部' },
  { id: 'draft', label: '草稿' },
  { id: 'on_the_way', label: '在途' },
  { id: 'receiving', label: '收货中' },
  { id: 'completed', label: '收货完成' },
  { id: 'shelved', label: '上架完成' },
  { id: 'exception', label: '异常' },
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

function applyInboundFilters(list: InboundOrder[], f: InboundFilters) {
  return list.filter(o => {
    if (f.warehouse !== 'all' && o.warehouse !== f.warehouse) return false
    if (f.inboundType !== 'all' && o.inboundType !== f.inboundType) return false
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
  const scopedInbound = useMemo(() => dataScope.scope(inboundOrders), [dataScope, inboundOrders])
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') ?? 'all'
  const [tab, setTab] = useState(initialTab === 'submitted' ? 'on_the_way' : initialTab)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [draft, setDraft] = useState<InboundFilters>(defaultFilters)
  const [applied, setApplied] = useState<InboundFilters>(defaultFilters)
  const [detail, setDetail] = useState<InboundOrder | null>(null)
  const [syncing, setSyncing] = useState(false)

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
      window.alert(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncing(false)
    }
  }

  const filtered = useMemo(() => {
    let list = scopedInbound
    list = filterByTab(list, tab)
    list = applyInboundFilters(list, applied)
    return list
  }, [tab, applied, scopedInbound])

  const tabCounts = useMemo(() => ({
    all: scopedInbound.length,
    draft: scopedInbound.filter(o => o.status === 'draft').length,
    on_the_way: scopedInbound.filter(o => o.status === 'on_the_way').length,
    receiving: scopedInbound.filter(o => ['receiving', 'partial'].includes(o.status)).length,
    completed: scopedInbound.filter(o => ['partial', 'completed'].includes(o.status)).length,
    shelved: scopedInbound.filter(o => o.status === 'shelved').length,
    exception: scopedInbound.filter(o => o.status === 'exception').length,
  }), [scopedInbound])

  const setDraftField = <K extends keyof InboundFilters>(key: K, value: InboundFilters[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  const handleBulkImport = async () => {
    try {
      const { data, errors } = await importCsvFile(INBOUND_ORDER_COLUMNS, parseInboundOrders)
      if (errors.length > 0) {
        window.alert(`导入失败：\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? `\n…共 ${errors.length} 条` : ''}`)
        return
      }
      if (data.length === 0) {
        window.alert('未解析到有效预约单，请使用最新模板')
        return
      }

      const customerId = getCustomerIdForRole(role) ?? undefined
      const stockSource: StockSource = role === 'catalog' ? 'catalog' : 'owned'

      for (const order of data) {
        const totalQty = order.lines.reduce((s, l) => s + l.qty, 0)
        addInboundOrder({
          id: `ib-import-${Date.now()}-${order.headerKey}`,
          customerId,
          inboundNo: nextInboundNo(),
          source: role === 'catalog' ? '货盘' : '客户自发',
          inboundType: order.inboundType,
          deliveryMethod: order.deliveryMethod,
          stockSource,
          boxCount: new Set(order.lines.map(l => l.boxNo)).size,
          skuCount: new Set(order.lines.map(l => l.sku)).size,
          totalQty,
          receivedQty: 0,
          status: 'draft',
          createdAt: todayDateInput(),
          eta: order.eta,
          warehouse: 'jhb1',
          referenceNo: order.referenceNo || order.platformRef || undefined,
          trackingNo: order.trackingNo,
          skuHint: order.lines.map(l => l.sku).slice(0, 3).join(', '),
          remark: order.remark,
          lineItems: order.lines,
        })
      }

      window.alert(`已导入 ${data.length} 张入库预约单（草稿），请在列表中核对后提交`)
      setTab('draft')
    } catch (err) {
      if ((err as Error).message !== 'cancelled') console.error(err)
    }
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="入库记录"
        desc={dataScope.isAdmin ? '全平台入库单，可按客户筛选' : '已提交的预约入库单列表，跟踪在途、收货与上架进度'}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={syncing} onClick={() => void syncFromErp()}>
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? '刷新中…' : '立即刷新'}
            </Button>
            <DropdownBtn label="导入/导出" items={[
              { label: '批量导入预约单', onClick: () => void handleBulkImport() },
              { label: '导出列表', onClick: () => exportInboundOrders(filtered) },
              { label: '下载导入模板', onClick: downloadInboundOrderTemplate },
            ]} />
          </div>
        }
      />

      <ImportTemplateLegend columns={INBOUND_ORDER_COLUMNS} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="草稿" value={tabCounts.draft} sub="未提交的预约单" />
        <StatCard label="在途" value={tabCounts.on_the_way} sub="货物发往海外仓" />
        <StatCard label="收货中" value={tabCounts.receiving} />
        <StatCard label="异常" value={tabCounts.exception} alert={tabCounts.exception > 0} />
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
              { value: '自发头程', label: '自发头程' },
              { value: '中转入库', label: '中转入库' },
              { value: '货盘入库', label: '货盘入库' },
              { value: '退货入库', label: '退货入库' },
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
        <Table>
          <thead className="table-head">
            <tr>
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
              <th>操作</th>
            </tr>
          </thead>
          <tbody className="table-body">
            {filtered.map(o => (
              <tr key={o.id} className="table-row">
                <td className="table-cell"><MonoCode>{o.inboundNo}</MonoCode></td>
                <AdminCustomerCell customerId={o.customerId} scope={dataScope} />
                <td className="table-cell text-xs">{warehouseLabel(o.warehouse)}</td>
                <td className="table-cell text-xs">{o.inboundType}</td>
                <td className="table-cell text-xs">{DELIVERY_METHOD_LABELS[o.deliveryMethod]}</td>
                <td className="table-cell">
                  <span className={`text-[11px] font-semibold ${o.stockSource === 'owned' ? 'text-emerald-700' : 'text-violet-700'}`}>
                    {STOCK_SOURCE_LABELS[o.stockSource]}
                  </span>
                </td>
                <td className="table-cell text-xs">{o.eta ?? '—'}</td>
                <td className="table-cell text-xs text-text-secondary">{o.trackingNo ?? '—'}</td>
                <td className="table-cell text-xs">{o.boxCount}</td>
                <td className="table-cell text-xs font-semibold">{o.totalQty}</td>
                <td className="table-cell text-xs"><span className="font-semibold">{o.receivedQty}</span><span className="text-text-muted"> / {o.totalQty}</span></td>
                <td className="table-cell"><Badge status={o.status} label={statusLabels[o.status]} /></td>
                <td className="table-cell text-xs text-text-muted">{o.createdAt}</td>
                <td className="table-cell">
                  <div className="flex flex-wrap gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setDetail(o)}>详情</Button>
                    {!['draft'].includes(o.status) && INBOUND_DOWNLOAD_ITEMS.map(l => (
                      <Button
                        key={l}
                        variant="ghost"
                        size="sm"
                        title={`打印${l}`}
                        onClick={() => printInboundLabels(o, l as InboundLabelKind)}
                      >
                        <Printer className="h-3 w-3" />
                      </Button>
                    ))}
                    {o.status === 'draft' && (
                      <Link to={`/inbound?edit=${encodeURIComponent(o.id)}`}><Button variant="ghost" size="sm">编辑</Button></Link>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <TableFooter total={filtered.length} />
      </Card>

      <InboundDetailDrawer order={detail} onClose={() => setDetail(null)} onOrderChanged={() => setDetail(null)} />
    </div>
  )
}
