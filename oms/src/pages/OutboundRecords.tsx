import { useMemo, useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, ChevronDown, ChevronUp, RefreshCw, FileCheck } from 'lucide-react'
import { Badge, Button, Card, PageHeader, MonoCode, Tabs, Table, TableFooter, Select } from '../components/ui'
import {
  SearchField, FilterActions, inputCls, type SearchMode,
} from '../components/ui/filters'
import {
  ShipmentSource, formatCurrency, statusLabels, warehouseFilterOptions, warehouseLabel,
  LOGISTICS_CHANNELS, PLATFORM_OPTIONS, type LogisticsRecord,
} from '../data/mockData'
import { useOrders } from '../data/entityStore'
import { useOutboundOrders } from '../data/outboundStore'
import { useBilling } from '../data/billingStore'
import { buildOutboundFeeSummary, settlementStatusLabel } from '../data/outboundFeeUtils'
import { useLogisticsRecords, refreshLogisticsFromErp } from '../data/logisticsStore'
import {
  buildFulfillmentRows,
  filterFulfillmentRows,
  defaultFulfillmentFilters,
  SHIPMENT_SOURCE_LABELS,
  type FulfillmentRow,
  type FulfillmentFilters,
} from '../data/fulfillmentUtils'
import FulfillmentDetailDrawer from '../components/outbound/FulfillmentDetailDrawer'
import { PodStatusBadge, PodUploadModal, PodViewModal, PodRowActions, TableActionLink, actionLinkClass } from '../components/outbound/PodReceiptModals'
import { useRole } from '../auth/RoleContext'
import { useDataScope } from '../auth/useDataScope'
import { getCustomerCode, getCustomerIdForRole } from '../data/dataScope'

const LOGISTICS_TABS = [
  { id: 'in_transit', label: '运输中' },
  { id: 'delivered', label: '已签收' },
  { id: 'pod_pending', label: '待回传签收单' },
  { id: 'logistics_exception', label: '物流异常' },
] as const

const SOURCE_TABS: { id: string; label: string; source?: ShipmentSource }[] = [
  { id: 'all', label: '全部' },
  { id: 'platform_order', label: '平台订单', source: 'platform_order' },
  { id: 'catalog_dist', label: '货盘分销', source: 'catalog_dist' },
  { id: 'manual', label: '手工录入', source: 'manual' },
  { id: 'active', label: '进行中' },
]

const STATUS_FILTER_OPTIONS = [
  'pending_payment', 'pending_review', 'pending_ship', 'processing',
  'shipped_out', 'in_transit', 'delivered', 'partial_delivered', 'delivery_failed', 'exception', 'cancelled',
  'draft', 'pending', 'locked', 'picking', 'shipped',
]

function sourceBadgeClass(source: ShipmentSource | null) {
  if (source === 'platform_order') return 'bg-blue-50 text-blue-700'
  if (source === 'catalog_dist') return 'bg-violet-50 text-violet-700'
  return 'bg-surface-muted text-text-secondary'
}

export default function OutboundRecords() {
  const { role } = useRole()
  const dataScope = useDataScope()
  const orders = useOrders()
  const allOutbound = useOutboundOrders()
  const logistics = useLogisticsRecords()
  const { feeRecords } = useBilling()
  const scopedOutbound = useMemo(() => dataScope.scopeOutbound(allOutbound), [dataScope, allOutbound])
  const scopedOrders = useMemo(() => dataScope.scope(orders), [dataScope, orders])
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') ?? 'all'
  const urlOrderNo = searchParams.get('orderNo') ?? ''
  const urlOrderNoMode = (searchParams.get('orderNoMode') === 'exact' ? 'exact' : 'fuzzy') as SearchMode
  const [tab, setTab] = useState(initialTab)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [draft, setDraft] = useState<FulfillmentFilters>(() => ({
    ...defaultFulfillmentFilters,
    orderNo: urlOrderNo,
    orderNoMode: urlOrderNoMode,
  }))
  const [applied, setApplied] = useState<FulfillmentFilters>(() => ({
    ...defaultFulfillmentFilters,
    orderNo: urlOrderNo,
    orderNoMode: urlOrderNoMode,
  }))
  const [detailRow, setDetailRow] = useState<FulfillmentRow | null>(null)
  const [uploadTarget, setUploadTarget] = useState<LogisticsRecord | null>(null)
  const [viewTarget, setViewTarget] = useState<LogisticsRecord | null>(null)
  const [syncing, setSyncing] = useState(false)

  const syncLogisticsFromErp = async () => {
    const customerCode = getCustomerCode(getCustomerIdForRole(role) ?? undefined)
    if (!customerCode || customerCode === '—') {
      window.alert('请切换到客户角色后再同步 ERP 物流')
      return
    }
    setSyncing(true)
    try {
      const n = await refreshLogisticsFromErp(customerCode)
      window.alert(`已从 ERP 同步 ${n} 条物流记录`)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    if (!urlOrderNo) return
    setDraft(prev => ({ ...prev, orderNo: urlOrderNo, orderNoMode: urlOrderNoMode }))
    setApplied(prev => ({ ...prev, orderNo: urlOrderNo, orderNoMode: urlOrderNoMode }))
    setAdvancedOpen(true)
  }, [urlOrderNo, urlOrderNoMode])

  const scopedLogistics = useMemo(() => {
    const nos = new Set(scopedOutbound.map(o => o.outboundNo))
    return logistics.filter(l => nos.has(l.outboundNo))
  }, [logistics, scopedOutbound])

  const allRows = useMemo(
    () => buildFulfillmentRows(scopedOrders, scopedOutbound, scopedLogistics),
    [scopedOrders, scopedOutbound, scopedLogistics],
  )

  const filtered = useMemo(
    () => filterFulfillmentRows(allRows, tab, applied),
    [allRows, tab, applied],
  )

  const visibleSources = dataScope.isAdmin
    ? [...SOURCE_TABS, ...LOGISTICS_TABS]
    : role === 'catalog'
      ? [...SOURCE_TABS.filter(t => ['all', 'catalog_dist', 'active'].includes(t.id)), ...LOGISTICS_TABS]
      : role === 'ecommerce'
        ? [...SOURCE_TABS.filter(t => ['all', 'platform_order', 'manual', 'active'].includes(t.id)), ...LOGISTICS_TABS]
        : [...SOURCE_TABS, ...LOGISTICS_TABS]

  const tabCount = (tabId: string) => filterFulfillmentRows(allRows, tabId, applied).length

  const setDraftField = <K extends keyof FulfillmentFilters>(key: K, value: FulfillmentFilters[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="订单与出库"
        desc="出库单、物流回传与签收单（POD）统一在此查看；运单号由海外仓发货后自动回传"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={syncing} onClick={() => void syncLogisticsFromErp()}>
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? '刷新中…' : '刷新物流'}
            </Button>
            <Link to="/outbound">
              <Button size="sm"><Plus className="h-3.5 w-3.5" /> 预约发货</Button>
            </Link>
          </div>
        }
      />

      <div className="mb-4 flex items-start gap-3 rounded-xl bg-blue-50 px-4 py-3.5 ring-1 ring-blue-100">
        <FileCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
        <p className="text-xs text-blue-900">
          货送抵 Takealot 等平台仓后，可在列表行点击<strong className="font-semibold">「回传签收单」</strong>上传 POD（PDF/图片）。
        </p>
      </div>

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-text-muted">创建时间</label>
            <div className="flex items-center gap-1">
              <input type="date" value={draft.dateFrom} onChange={e => setDraftField('dateFrom', e.target.value)} className={inputCls} />
              <span className="shrink-0 text-text-muted">—</span>
              <input type="date" value={draft.dateTo} onChange={e => setDraftField('dateTo', e.target.value)} className={inputCls} />
            </div>
          </div>
          <SearchField
            label="订单号 / 出库单号"
            value={draft.orderNo}
            onChange={v => setDraftField('orderNo', v)}
            mode={draft.orderNoMode}
            onModeChange={v => setDraftField('orderNoMode', v as SearchMode)}
          />
          <Select label="平台" value={draft.platform} onChange={v => setDraftField('platform', v)} options={[
            { value: 'all', label: '全部' },
            ...PLATFORM_OPTIONS.map(p => ({ value: p, label: p })),
          ]} />
          <Select label="平台店铺" value={draft.store} onChange={v => setDraftField('store', v)} options={[
            { value: 'all', label: '全部' },
            { value: '主店', label: '主店' },
            { value: '副店', label: '副店' },
            { value: '独立站', label: '独立站' },
          ]} />
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-border-light pt-3">
          <button
            type="button"
            onClick={() => setAdvancedOpen(v => !v)}
            className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline"
          >
            {advancedOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            高级搜索
          </button>
          <FilterActions
            onQuery={() => setApplied({ ...draft })}
            onReset={() => { setDraft(defaultFulfillmentFilters); setApplied(defaultFulfillmentFilters) }}
          />
        </div>
        {advancedOpen && (
          <div className="mt-3 grid gap-3 border-t border-border-light pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <SearchField label="SKU" value={draft.sku} onChange={v => setDraftField('sku', v)} mode={draft.skuMode} onModeChange={v => setDraftField('skuMode', v as SearchMode)} />
            <Select label="仓库" value={draft.warehouse} onChange={v => setDraftField('warehouse', v)} options={warehouseFilterOptions()} />
            <Select label="履约状态" value={draft.status} onChange={v => setDraftField('status', v)} options={[
              { value: 'all', label: '全部' },
              ...STATUS_FILTER_OPTIONS
                .filter(k => statusLabels[k])
                .map(value => ({ value, label: statusLabels[value] })),
            ]} />
            <Select label="物流渠道" value={draft.logistics} onChange={v => setDraftField('logistics', v)} options={[
              { value: 'all', label: '全部' },
              ...LOGISTICS_CHANNELS.map(c => ({ value: c, label: c })),
            ]} />
          </div>
        )}
      </Card>

      <div className="mb-4 overflow-x-auto">
        <Tabs
          tabs={visibleSources.map(t => ({
            id: t.id,
            label: t.label,
            count: tabCount(t.id),
          }))}
          active={tab}
          onChange={setTab}
        />
      </div>

      <Card className="overflow-hidden">
        <Table>
          <thead className="table-head">
            <tr>
              <th className="whitespace-nowrap">出库单号</th>
              <th className="whitespace-nowrap">参考号</th>
              <th className="whitespace-nowrap">跟踪号/运单号</th>
              <th className="whitespace-nowrap">物流渠道</th>
              <th className="whitespace-nowrap">发货来源</th>
              <th className="whitespace-nowrap">平台</th>
              <th className="whitespace-nowrap">店铺</th>
              <th className="whitespace-nowrap">仓库</th>
              <th className="whitespace-nowrap">履约状态</th>
              <th className="whitespace-nowrap">物流状态</th>
              <th className="whitespace-nowrap">签收单</th>
              <th className="whitespace-nowrap">费用对账</th>
              <th className="whitespace-nowrap text-right">金额</th>
              <th className="whitespace-nowrap">时间</th>
              <th className="w-[76px] whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody className="table-body">
            {filtered.length === 0 ? (
              <tr><td colSpan={15} className="table-cell py-10 text-center text-xs text-text-muted">暂无数据</td></tr>
            ) : filtered.map(r => {
              const feeSummary = r.outbound ? buildOutboundFeeSummary(r.outbound, feeRecords) : null
              return (
              <tr key={r.id} className="table-row">
                <td className="table-cell"><MonoCode>{r.outboundNo}</MonoCode></td>
                <td className="table-cell text-xs">
                  {r.refNo ? <MonoCode>{r.refNo}</MonoCode> : <span className="text-text-muted">—</span>}
                </td>
                <td className="table-cell font-mono text-xs text-text-muted">
                  {r.trackingNo ?? <span className="text-text-muted">待海外仓回传</span>}
                </td>
                <td className="table-cell text-xs">{r.shippingMethod ?? '—'}</td>
                <td className="table-cell">
                  {r.source ? (
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${sourceBadgeClass(r.source)}`}>
                      {SHIPMENT_SOURCE_LABELS[r.source]}
                    </span>
                  ) : '—'}
                </td>
                <td className="table-cell text-xs">{r.platform}</td>
                <td className="table-cell text-xs text-text-secondary">{r.store}</td>
                <td className="table-cell text-xs font-medium">{warehouseLabel(r.warehouse)}</td>
                <td className="table-cell">
                  <Badge status={r.statusKey} label={r.statusLabel} />
                </td>
                <td className="table-cell">
                  {r.logistics ? (
                    <Badge status={r.logistics.status} label={statusLabels[r.logistics.status] ?? r.logistics.status} />
                  ) : (
                    <span className="text-xs text-text-muted">—</span>
                  )}
                </td>
                <td className="table-cell">
                  {r.logistics ? <PodStatusBadge status={r.logistics.podStatus} /> : <span className="text-xs text-text-muted">—</span>}
                </td>
                <td className="table-cell text-xs">
                  {feeSummary && feeSummary.preDeductTotal > 0 ? (
                    <div className="space-y-0.5">
                      <p className="text-text-secondary">
                        预扣 {formatCurrency(feeSummary.preDeductTotal)}
                        {feeSummary.actualTotal > 0 && (
                          <> · 实扣 {formatCurrency(feeSummary.actualTotal)}</>
                        )}
                      </p>
                      {feeSummary.settlementStatus && feeSummary.settlementStatus !== 'pending' ? (
                        <Badge
                          status={feeSummary.settlementStatus === 'settled' ? 'available' : 'shipped'}
                          label={settlementStatusLabel(feeSummary.settlementStatus)}
                        />
                      ) : (
                        <span className="text-[10px] text-amber-700">待 ERP 发运对账</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className="table-cell text-right text-xs font-semibold">
                  {r.amount != null ? formatCurrency(r.amount) : '—'}
                </td>
                <td className="table-cell text-xs text-text-muted whitespace-nowrap">{r.createdAt}</td>
                <td className="table-cell align-top">
                  <div className="flex min-w-[72px] flex-col gap-0.5">
                    <TableActionLink onClick={() => setDetailRow(r)}>查看</TableActionLink>
                    {r.outbound?.status === 'draft' && (
                      <Link to={`/outbound?edit=${encodeURIComponent(r.outbound.id)}`} className={actionLinkClass()}>
                        编辑
                      </Link>
                    )}
                    <PodRowActions
                      record={r.logistics}
                      onUpload={setUploadTarget}
                      onView={setViewTarget}
                    />
                  </div>
                </td>
              </tr>
              )
            })}
          </tbody>
        </Table>
        <TableFooter total={filtered.length} />
      </Card>

      <FulfillmentDetailDrawer
        row={detailRow}
        open={!!detailRow}
        onClose={() => setDetailRow(null)}
        onUploadPod={setUploadTarget}
        onViewPod={setViewTarget}
      />

      <PodUploadModal
        record={uploadTarget}
        customerCode={dataScope.activeCustomerCode !== '全平台' ? dataScope.activeCustomerCode : undefined}
        onClose={() => setUploadTarget(null)}
      />
      <PodViewModal record={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  )
}
