import { useEffect, useMemo, useState } from 'react'
import { apiGet } from '../api/client'
import { Card, PageHeader, StatCard } from '../components/ui'

type ReportSummary = {
  inventoryTurnoverDays: number | null
  fulfillmentRate: number
  totals: { outboundOrders: number; completedOrders: number; exceptionOrders: number; inventoryUnits: number; fees: number }
  orderTrend: { key: string; label: string; orders: number; units: number; amount: number }[]
  feeBreakdown: { type: string; label: string; amount: number; pct: number }[]
}

const formatCurrency = (value: number) => `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function ReportsPage() {
  const [data, setData] = useState<ReportSummary | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    apiGet<ReportSummary>('/reports/summary').then(setData).catch(err => setError(err instanceof Error ? err.message : '报表加载失败'))
  }, [])
  const maxOrders = useMemo(() => Math.max(1, ...(data?.orderTrend || []).map(item => item.orders)), [data])

  return (
    <div className="page-shell">
      <PageHeader title="报表中心" desc="真实出库、库存与费用数据（按当前账号权限范围统计）" />
      {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {!data && !error && <Card padding><p className="text-sm text-text-secondary">正在汇总真实业务数据…</p></Card>}
      {data && <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="估算库存周转" value={data.inventoryTurnoverDays ?? '暂无'} sub={data.inventoryTurnoverDays == null ? '尚无出库数据' : '天'} />
        <StatCard label="出库完成率" value={`${data.fulfillmentRate}%`} sub={`${data.totals.completedOrders}/${data.totals.outboundOrders} 单`} />
        <StatCard label="当前库存" value={data.totals.inventoryUnits.toLocaleString()} sub="可用 + 锁定件数" />
        <StatCard label="累计费用流水" value={formatCurrency(data.totals.fees)} sub={`异常单 ${data.totals.exceptionOrders}`} alert={data.totals.exceptionOrders > 0} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card padding>
          <h3 className="mb-4 text-sm font-semibold text-text-primary">订单量趋势</h3>
          <div className="space-y-3">
            {data.orderTrend.map(t => (
              <div key={t.key}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-text-secondary">{t.label}</span>
                  <span className="font-semibold">{t.orders} 单 · {t.units} 件 · {formatCurrency(t.amount)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-subtle">
                  <div className="h-full rounded-full bg-primary-500" style={{ width: `${(t.orders / maxOrders) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card padding>
          <h3 className="mb-4 text-sm font-semibold text-text-primary">费用占比</h3>
          <div className="space-y-4">
            {!data.feeBreakdown.length && <p className="text-sm text-text-muted">暂无费用流水</p>}
            {data.feeBreakdown.map(f => (
              <div key={f.type}>
                <div className="mb-1 flex justify-between text-xs">
                  <span>{f.label} · {formatCurrency(f.amount)}</span><span className="font-semibold">{f.pct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-subtle">
                  <div className="h-full rounded-full bg-primary-400" style={{ width: `${f.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      </>}
    </div>
  )
}
