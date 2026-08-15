import { useState, useMemo } from 'react'
import { AlertCircle } from 'lucide-react'
import {
  Badge, Button, Card, PageHeader, SearchInput, MonoCode, StatCard,
  Table, TableFooter, FeatureIntro, FilterChip, InfoRow, SectionTitle,
} from '../components/ui'
import { MODULE_GUIDES } from '../data/moduleGuide'
import { StoreAccount, statusLabels } from '../data/mockData'
import { useStores } from '../data/entityStore'

const platformColors: Record<string, string> = {
  Takealot: 'text-orange-700 bg-orange-50 ring-orange-100',
  Shopify: 'text-emerald-700 bg-emerald-50 ring-emerald-100',
  Manual: 'text-slate-600 bg-slate-50 ring-slate-200',
}

export default function StoresPage() {
  const stores = useStores()
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('all')
  const [selected, setSelected] = useState<StoreAccount | null>(null)

  const filtered = useMemo(() => {
    let list = stores
    if (tab === 'connected') list = list.filter(s => s.status === 'connected')
    if (tab === 'sync_fail') list = list.filter(s => s.status === 'sync_fail')
    if (tab === 'disabled') list = list.filter(s => s.status === 'disabled')
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.name.includes(search) ||
        s.storeCode.toLowerCase().includes(q) ||
        s.platform.toLowerCase().includes(q)
      )
    }
    return list
  }, [tab, search, stores])

  const connectedCount = stores.filter(s => s.status === 'connected').length
  const failCount = stores.filter(s => s.status === 'sync_fail').length
  const todayTotal = stores.reduce((n, s) => n + s.todayOrders, 0)

  const tabs = [
    { id: 'all', label: '全部', count: stores.length },
    { id: 'connected', label: '已连接', count: connectedCount },
    { id: 'sync_fail', label: '同步异常', count: failCount },
    { id: 'disabled', label: '已停用', count: stores.filter(s => s.status === 'disabled').length },
  ]

  return (
    <div className="page-shell">
      <PageHeader title="店铺管理" desc={MODULE_GUIDES.stores.desc} />

      <FeatureIntro guide={MODULE_GUIDES.stores} className="mb-4" />

      <div className="mb-4 rounded-xl bg-surface-muted px-4 py-3 ring-1 ring-border-light">
        <p className="text-xs text-text-secondary">
          店铺绑定、同步与授权配置需对接平台 API，当前页面为只读展示。如需新增或修改店铺，请联系系统管理员。
        </p>
      </div>

      {failCount > 0 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl bg-red-50 px-4 py-3 ring-1 ring-red-100">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <p className="text-xs text-red-800">
            <span className="font-semibold">{failCount} 个店铺同步异常</span>
            {' '}— 请检查 API 授权或联系管理员重新绑定，避免订单漏同步。
          </p>
        </div>
      )}

      <div className="mb-4 grid grid-cols-3 gap-4">
        <StatCard label="已连接店铺" value={connectedCount} sub={`共 ${stores.length} 个`} />
        <StatCard label="今日同步订单" value={todayTotal} />
        <StatCard label="同步异常" value={failCount} alert={failCount > 0} />
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {tabs.map(t => (
            <FilterChip key={t.id} active={tab === t.id} onClick={() => setTab(t.id)} alert={t.id === 'sync_fail' && t.count > 0}>
              {t.label} ({t.count})
            </FilterChip>
          ))}
        </div>
        <SearchInput placeholder="店铺名称 / 编码" value={search} onChange={setSearch} className="w-56" />
      </div>

      <Card className="overflow-hidden">
        <Table>
          <thead className="table-head">
            <tr>
              <th>平台</th>
              <th>店铺名称</th>
              <th>店铺编码</th>
              <th>连接状态</th>
              <th>订单同步</th>
              <th>库存同步</th>
              <th>拉单频率</th>
              <th>今日订单</th>
              <th>最近同步</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody className="table-body">
            {filtered.map(store => (
              <tr key={store.id} className="table-row">
                <td className="table-cell">
                  <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ${platformColors[store.platform]}`}>
                    {store.platform}
                  </span>
                </td>
                <td className="table-cell text-sm font-medium text-text-primary">{store.name}</td>
                <td className="table-cell"><MonoCode>{store.storeCode}</MonoCode></td>
                <td className="table-cell">
                  <Badge status={store.status} label={statusLabels[store.status]} />
                </td>
                <td className="table-cell text-xs">{store.orderSync ? <span className="text-emerald-600 font-medium">开启</span> : <span className="text-text-muted">关闭</span>}</td>
                <td className="table-cell text-xs">{store.inventorySync ? <span className="text-emerald-600 font-medium">开启</span> : <span className="text-text-muted">关闭</span>}</td>
                <td className="table-cell text-xs text-text-secondary">{store.autoPullInterval}</td>
                <td className="table-cell text-xs font-semibold">{store.todayOrders}</td>
                <td className="table-cell text-xs text-text-muted whitespace-nowrap">{store.lastSyncAt}</td>
                <td className="table-cell">
                  <Button variant="ghost" size="sm" onClick={() => setSelected(store)}>详情</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <TableFooter total={filtered.length} />
      </Card>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm" onClick={() => setSelected(null)} />
          <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="border-b border-border-light px-6 py-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-lg font-semibold text-text-primary">{selected.name}</p>
                  <p className="mt-1 text-xs text-text-muted">{selected.platform} · {selected.storeCode}</p>
                </div>
                <Badge status={selected.status} label={statusLabels[selected.status]} />
              </div>
              {selected.syncError && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-100">{selected.syncError}</p>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 scrollbar-thin">
              <SectionTitle>同步设置</SectionTitle>
              <InfoRow label="订单自动拉取" value={selected.orderSync ? '已开启' : '已关闭'} />
              <InfoRow label="库存回写" value={selected.inventorySync ? '已开启' : '已关闭'} />
              <InfoRow label="拉单频率" value={selected.autoPullInterval} />
              <InfoRow label="最近同步" value={selected.lastSyncAt} />
              <div className="my-4 border-t border-border-light" />
              <SectionTitle>授权信息</SectionTitle>
              <InfoRow label="Seller ID" value={selected.sellerId} />
              <InfoRow label="API Key" value={<MonoCode>{selected.apiKeyMasked}</MonoCode>} />
              <InfoRow label="Webhook" value={<span className="break-all text-xs">{selected.webhookUrl}</span>} />
              <InfoRow label="绑定时间" value={selected.createdAt} />
            </div>
            <div className="border-t border-border-light px-6 py-4">
              <Button variant="secondary" className="w-full" size="sm" onClick={() => setSelected(null)}>关闭</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
