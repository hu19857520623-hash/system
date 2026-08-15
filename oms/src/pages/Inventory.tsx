import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Download, RefreshCw, ListOrdered } from 'lucide-react'
import {
  Button, PageHeader, Select, Badge, MonoCode, Card, StatCard, Table, TableFooter, FilterChip, Drawer,
} from '../components/ui'
import {
  SearchField, FilterActions, inputCls, matchText, type SearchMode,
} from '../components/ui/filters'
import {
  getInventoryStatus, statusLabels, STOCK_SOURCE_LABELS, type StockSource, warehouseFilterOptions, warehouseLabel,
} from '../data/mockData'
import { refreshInventoryFromErp, useInventoryItems } from '../data/inventoryStore'
import { useOutboundOrders } from '../data/outboundStore'
import { loadSkuOutboundLogs, type SkuOutboundLogRow } from '../data/inventoryOutboundLogs'
import { useDataScope } from '../auth/useDataScope'
import { getCustomerCode, getCustomerIdForRole } from '../data/dataScope'
import { useRole } from '../auth/RoleContext'
import { AdminCustomerFilter } from '../components/admin/AdminCustomerFilter'
import { exportInventoryCsv } from '../data/listExport'
import { findProductByCode } from '../data/platformBindingUtils'
import { calcSkuVolumeM3 } from '../data/feeTemplates'

interface InventoryPageProps {
  alertsOnly?: boolean
}

interface InvFilters {
  sku: string
  skuMode: SearchMode
  customCode: string
  customCodeMode: SearchMode
  productName: string
  productNameMode: SearchMode
  ean: string
  warehouse: string
  qtyType: string
  qtyMin: string
  qtyMax: string
}

const defaultFilters: InvFilters = {
  sku: '', skuMode: 'exact',
  customCode: '', customCodeMode: 'fuzzy',
  productName: '', productNameMode: 'fuzzy',
  ean: '', warehouse: 'all', qtyType: 'available',
  qtyMin: '', qtyMax: '',
}

function getMeasuredVolume(sku: string) {
  const prod = findProductByCode(sku)
  if (!prod) return null
  const volumeM3 = calcSkuVolumeM3(
    { lengthCm: prod.lengthCm, widthCm: prod.widthCm, heightCm: prod.heightCm, weightKg: prod.weightKg },
    1,
  )
  return {
    volumeM3,
    dims: `${prod.lengthCm}×${prod.widthCm}×${prod.heightCm} cm`,
  }
}

function getQtyByType(item: ReturnType<typeof useInventoryItems>[0], type: string) {
  switch (type) {
    case 'available': return item.available
    case 'locked': return item.locked
    case 'pendingShelving': return item.pendingShelving
    case 'pendingOutbound': return item.pendingOutbound
    case 'defective': return item.defective
    case 'inTransit': return item.inTransit
    case 'shipped': return item.shipped
    default: return item.available
  }
}

function applyInvFilters(list: ReturnType<typeof useInventoryItems>, f: InvFilters) {
  return list.filter(i => {
    if (f.warehouse !== 'all' && i.warehouse !== f.warehouse) return false
    if (!matchText(i.sku, f.sku, f.skuMode)) return false
    if (!matchText(i.customCode ?? '', f.customCode, f.customCodeMode)) return false
    if (!matchText(i.name, f.productName, f.productNameMode)) return false
    if (f.ean && !(i.ean ?? '').includes(f.ean)) return false
    const qty = getQtyByType(i, f.qtyType)
    if (f.qtyMin && qty < parseFloat(f.qtyMin)) return false
    if (f.qtyMax && qty > parseFloat(f.qtyMax)) return false
    return true
  })
}

export default function InventoryPage({ alertsOnly }: InventoryPageProps) {
  const { role } = useRole()
  const dataScope = useDataScope()
  const allInventory = useInventoryItems()
  const allOutbound = useOutboundOrders()
  const scopedInventory = useMemo(() => dataScope.scope(allInventory), [dataScope, allInventory])
  const scopedOutbound = useMemo(() => dataScope.scopeOutbound(allOutbound), [dataScope, allOutbound])
  const [poolTab, setPoolTab] = useState<'all' | StockSource>('all')
  const [tab, setTab] = useState(alertsOnly ? 'low' : 'all')
  const [filtersOpen, setFiltersOpen] = useState(!alertsOnly)
  const [draft, setDraft] = useState<InvFilters>(defaultFilters)
  const [applied, setApplied] = useState<InvFilters>(defaultFilters)
  const [syncing, setSyncing] = useState(false)
  const [outboundDrawerOpen, setOutboundDrawerOpen] = useState(false)
  const [outboundDrawerSku, setOutboundDrawerSku] = useState('')
  const [outboundDrawerLoading, setOutboundDrawerLoading] = useState(false)
  const [outboundDrawerRows, setOutboundDrawerRows] = useState<SkuOutboundLogRow[]>([])
  const [outboundDrawerHint, setOutboundDrawerHint] = useState('')

  const resolveCustomerCode = () => {
    if (dataScope.isAdmin) {
      if (dataScope.customerFilter === 'all') return null
      return dataScope.getCustomerCode(dataScope.customerFilter)
    }
    return dataScope.activeCustomerId ? dataScope.getCustomerCode(dataScope.activeCustomerId) : null
  }

  const openSkuOutboundLogs = async (sku: string) => {
    setOutboundDrawerSku(sku)
    setOutboundDrawerOpen(true)
    setOutboundDrawerLoading(true)
    setOutboundDrawerRows([])
    setOutboundDrawerHint('')
    try {
      const result = await loadSkuOutboundLogs(resolveCustomerCode(), sku, scopedOutbound)
      setOutboundDrawerRows(result.items)
      if (result.needCustomer) {
        setOutboundDrawerHint('管理员请先选择客户，以查询 ERP 同步的出库单；当前仅显示 OMS 本地记录。')
      } else if (result.erpUnavailable) {
        setOutboundDrawerHint('ERP 出库单查询失败，已显示 OMS 本地记录。')
      } else if (!result.items.length) {
        setOutboundDrawerHint('该 SKU 暂无出库记录。')
      }
    } catch (err) {
      setOutboundDrawerHint(err instanceof Error ? err.message : '加载出库记录失败')
    } finally {
      setOutboundDrawerLoading(false)
    }
  }

  const syncFromErp = async () => {
    const customerId = getCustomerIdForRole(role)
    const customerCode = getCustomerCode(customerId ?? undefined)
    if (!customerId || !customerCode || customerCode === '—') {
      window.alert('请切换到客户角色后再同步 ERP 库存')
      return
    }
    setSyncing(true)
    try {
      const n = await refreshInventoryFromErp(customerId, customerCode)
      window.alert(`已从 ERP 同步 ${n} 条客户持有库存`)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncing(false)
    }
  }

  const filtered = useMemo(() => {
    let list = applyInvFilters(scopedInventory, applied)
    if (poolTab !== 'all') list = list.filter(i => i.stockSource === poolTab)
    if (tab === 'low') list = list.filter(i => getInventoryStatus(i) === 'low')
    if (tab === 'out') list = list.filter(i => getInventoryStatus(i) === 'out')
    if (tab === 'locked') list = list.filter(i => i.locked > 0)
    if (tab === 'pendingShelving') list = list.filter(i => i.pendingShelving > 0)
    return list
  }, [tab, applied, poolTab, scopedInventory])

  const ownedItems = scopedInventory.filter(i => i.stockSource === 'owned')
  const catalogItems = scopedInventory.filter(i => i.stockSource === 'catalog')
  const totalAvailable = scopedInventory.reduce((s, i) => s + i.available, 0)
  const ownedAvailable = ownedItems.reduce((s, i) => s + i.available, 0)
  const catalogAvailable = catalogItems.reduce((s, i) => s + i.available, 0)
  const totalLocked = scopedInventory.reduce((s, i) => s + i.locked, 0)
  const alertCount = scopedInventory.filter(i => getInventoryStatus(i) !== 'normal').length

  const tabs = [
    { id: 'all', label: '全部', count: scopedInventory.length },
    { id: 'low', label: '低库存', count: scopedInventory.filter(i => getInventoryStatus(i) === 'low').length },
    { id: 'out', label: '缺货', count: scopedInventory.filter(i => getInventoryStatus(i) === 'out').length },
    { id: 'locked', label: '有锁定', count: scopedInventory.filter(i => i.locked > 0).length },
    { id: 'pendingShelving', label: '待上架', count: scopedInventory.filter(i => i.pendingShelving > 0).length },
  ]

  const setDraftField = <K extends keyof InvFilters>(key: K, value: InvFilters[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="page-shell">
      <PageHeader
        title={alertsOnly ? '库存预警' : '库存查询'}
        desc={dataScope.isAdmin ? '全平台库存总览，可按客户筛选' : (alertsOnly ? '低库存与断货风险 SKU 列表' : '分池查询：自有库存（电商入库）与货盘库存（选品入库），支持多维度数量筛选')}
        action={
          <>
            <Button variant="secondary" size="sm" onClick={() => exportInventoryCsv(filtered)}>
              <Download className="h-3.5 w-3.5" /> 导出
            </Button>
            <Button variant="secondary" size="sm" disabled={syncing} onClick={() => void syncFromErp()}>
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? '刷新中…' : '立即刷新'}
            </Button>
          </>
        }
      />

      {!alertsOnly && (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {([
              { id: 'all' as const, label: '全部库存', count: scopedInventory.length },
              { id: 'owned' as const, label: '自有库存', count: ownedItems.length },
              { id: 'catalog' as const, label: '货盘库存', count: catalogItems.length },
            ]).map(p => (
              <FilterChip key={p.id} active={poolTab === p.id} onClick={() => setPoolTab(p.id)}>
                {p.label} ({p.count})
              </FilterChip>
            ))}
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
            <StatCard label="SKU 总数" value={scopedInventory.length} />
            <StatCard label="可用库存" value={totalAvailable.toLocaleString()} />
            <StatCard label="自有可用" value={ownedAvailable.toLocaleString()} sub={STOCK_SOURCE_LABELS.owned} />
            <StatCard label="货盘可用" value={catalogAvailable.toLocaleString()} sub={STOCK_SOURCE_LABELS.catalog} />
            <StatCard label="锁定库存" value={totalLocked.toLocaleString()} sub="出库占用" />
            <StatCard label="预警 SKU" value={alertCount} alert={alertCount > 0} />
          </div>
        </>
      )}

      {!alertsOnly && (
        <Card className="mb-4 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-text-primary">筛选条件</p>
            <button type="button" onClick={() => setFiltersOpen(v => !v)} className="text-xs text-primary-600 hover:underline">
              {filtersOpen ? '收起' : '展开'}
            </button>
          </div>
          {filtersOpen && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {dataScope.isAdmin && <AdminCustomerFilter scope={dataScope} />}
              <SearchField label="SKU" value={draft.sku} onChange={v => setDraftField('sku', v)} mode={draft.skuMode} onModeChange={v => setDraftField('skuMode', v)} />
              <SearchField label="自定义编号" value={draft.customCode} onChange={v => setDraftField('customCode', v)} mode={draft.customCodeMode} onModeChange={v => setDraftField('customCodeMode', v)} />
              <SearchField label="产品名称" value={draft.productName} onChange={v => setDraftField('productName', v)} mode={draft.productNameMode} onModeChange={v => setDraftField('productNameMode', v)} />
              <div>
                <label className="mb-1 block text-[11px] font-medium text-text-muted">EAN / 条码</label>
                <input value={draft.ean} onChange={e => setDraftField('ean', e.target.value)} className={inputCls} />
              </div>
              <Select label="仓库" value={draft.warehouse} onChange={v => setDraftField('warehouse', v)} options={warehouseFilterOptions()} />
              <Select label="数量类型" value={draft.qtyType} onChange={v => setDraftField('qtyType', v)} options={[
                { value: 'available', label: '可用' },
                { value: 'locked', label: '锁定' },
                { value: 'pendingShelving', label: '待上架' },
                { value: 'pendingOutbound', label: '待出库' },
                { value: 'defective', label: '不良品' },
                { value: 'inTransit', label: '在途' },
                { value: 'shipped', label: '已出库' },
              ]} />
              <div>
                <label className="mb-1 block text-[11px] font-medium text-text-muted">数量范围</label>
                <div className="flex items-center gap-1">
                  <input value={draft.qtyMin} onChange={e => setDraftField('qtyMin', e.target.value)} placeholder="最小" className={inputCls} />
                  <span className="text-text-muted">—</span>
                  <input value={draft.qtyMax} onChange={e => setDraftField('qtyMax', e.target.value)} placeholder="最大" className={inputCls} />
                </div>
              </div>
              <FilterActions
                onQuery={() => setApplied({ ...draft })}
                onReset={() => { setDraft(defaultFilters); setApplied(defaultFilters) }}
              />
            </div>
          )}
        </Card>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map(t => (
          <FilterChip key={t.id} active={tab === t.id} onClick={() => setTab(t.id)} alert={t.id === 'out' && t.count > 0}>
            {t.label} ({t.count})
          </FilterChip>
        ))}
      </div>

      <Card className="overflow-hidden">
        <Table>
          <thead className="table-head">
            <tr>
              <th className="min-w-[220px]">商品</th>
              <th>实测体积</th>
              <th>SKU</th>
              <th>自定义编号</th>
              <th>仓库</th>
              <th>库存来源</th>
              <th className="text-right">可用</th>
              <th className="text-right">待上架</th>
              <th className="text-right">待出库</th>
              <th className="text-right">锁定</th>
              <th className="text-right">在途</th>
              <th className="text-right">不良品</th>
              <th className="text-right">已出库</th>
              <th>状态</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody className="table-body">
            {filtered.map(item => {
              const st = getInventoryStatus(item)
              const measured = getMeasuredVolume(item.sku)
              return (
                <tr key={item.id} className="table-row">
                  <td className="table-cell">
                    <div className="flex items-center gap-2.5">
                      <img src={item.image} alt="" className="h-10 w-10 rounded-lg object-cover ring-1 ring-border-light" />
                      <div>
                        <p className="text-xs font-medium text-text-primary">{item.name}</p>
                        <p className="text-[10px] text-text-muted">{item.spec}</p>
                        {item.ean && <p className="text-[10px] text-text-muted">EAN: {item.ean}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="table-cell text-xs">
                    {measured ? (
                      <>
                        <p className="font-medium text-text-primary">{measured.volumeM3.toFixed(4)} m³</p>
                        <p className="text-[10px] text-text-muted">{measured.dims}</p>
                      </>
                    ) : '—'}
                  </td>
                  <td className="table-cell"><MonoCode>{item.sku}</MonoCode></td>
                  <td className="table-cell text-xs">{item.customCode ? <MonoCode>{item.customCode}</MonoCode> : '—'}</td>
                  <td className="table-cell text-xs">{warehouseLabel(item.warehouse)}</td>
                  <td className="table-cell">
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                      item.stockSource === 'owned' ? 'bg-emerald-50 text-emerald-700' : 'bg-violet-50 text-violet-700'
                    }`}>{STOCK_SOURCE_LABELS[item.stockSource]}</span>
                  </td>
                  <td className={`table-cell text-right font-semibold ${st !== 'normal' ? (st === 'out' ? 'text-red-600' : 'text-amber-600') : ''}`}>
                    {item.available.toLocaleString()}
                  </td>
                  <td className="table-cell text-right text-xs">{item.pendingShelving > 0 ? item.pendingShelving : '—'}</td>
                  <td className="table-cell text-right text-xs">{item.pendingOutbound > 0 ? item.pendingOutbound : '—'}</td>
                  <td className="table-cell text-right text-xs">{item.locked > 0 ? <span className="font-medium text-amber-600">{item.locked}</span> : '0'}</td>
                  <td className="table-cell text-right text-xs text-text-secondary">{item.inTransit > 0 ? item.inTransit : '—'}</td>
                  <td className="table-cell text-right text-xs">{item.defective > 0 ? <span className="text-red-600">{item.defective}</span> : '—'}</td>
                  <td className="table-cell text-right text-xs text-text-secondary">{item.shipped > 0 ? item.shipped : '—'}</td>
                  <td className="table-cell"><Badge status={st} label={statusLabels[st]} /></td>
                  <td className="table-cell text-right">
                    <Button variant="ghost" size="sm" className="!px-2 !py-1" onClick={() => void openSkuOutboundLogs(item.sku)}>
                      <ListOrdered className="h-3.5 w-3.5" />
                      出库记录
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
        <TableFooter total={filtered.length} />
      </Card>

      <Drawer
        open={outboundDrawerOpen}
        onClose={() => setOutboundDrawerOpen(false)}
        title={`出库记录 · ${outboundDrawerSku}`}
        subtitle="查看包含该 SKU 的出库单及出库数量"
      >
        {outboundDrawerLoading ? (
          <p className="py-8 text-center text-sm text-text-muted">加载中…</p>
        ) : outboundDrawerRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-muted">{outboundDrawerHint || '暂无出库记录'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-light text-left text-text-muted">
                  <th className="py-2 pr-3 font-medium">出库单号</th>
                  <th className="py-2 pr-3 font-medium">数量</th>
                  <th className="py-2 pr-3 font-medium">状态</th>
                  <th className="py-2 pr-3 font-medium">参考号</th>
                  <th className="py-2 pr-3 font-medium">目的地</th>
                  <th className="py-2 pr-3 font-medium">创建日期</th>
                  <th className="py-2 font-medium">运单号</th>
                </tr>
              </thead>
              <tbody>
                {outboundDrawerRows.map(row => (
                  <tr key={row.outboundNo} className="border-b border-border-light/70">
                    <td className="py-2.5 pr-3">
                      <Link
                        to={`/outbound/records?orderNo=${encodeURIComponent(row.outboundNo)}&orderNoMode=exact`}
                        className="font-medium text-primary-600 hover:underline"
                        onClick={() => setOutboundDrawerOpen(false)}
                      >
                        <MonoCode>{row.outboundNo}</MonoCode>
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3 font-semibold text-text-primary">{row.qty}</td>
                    <td className="py-2.5 pr-3"><Badge status={row.status} label={row.statusLabel} /></td>
                    <td className="py-2.5 pr-3 text-text-secondary">{row.refNo || '—'}</td>
                    <td className="py-2.5 pr-3 text-text-secondary">{row.destination || '—'}</td>
                    <td className="py-2.5 pr-3 text-text-secondary">{row.createdAt || '—'}</td>
                    <td className="py-2.5 text-text-secondary">{row.trackingNo || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {outboundDrawerHint && outboundDrawerRows.length > 0 && (
          <p className="mt-4 text-xs text-amber-700">{outboundDrawerHint}</p>
        )}
        <div className="mt-4 flex justify-end">
          <Link to="/outbound/records" onClick={() => setOutboundDrawerOpen(false)}>
            <Button variant="secondary" size="sm">前往出库记录</Button>
          </Link>
        </div>
      </Drawer>
    </div>
  )
}
