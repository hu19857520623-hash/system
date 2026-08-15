import { Card, PageHeader, StatCard } from '../components/ui'
import { reportSummary, formatCurrency } from '../data/mockData'

export default function ReportsPage() {
  const maxOrders = Math.max(...reportSummary.orderTrend.map(t => t.orders))

  return (
    <div className="page-shell">
      <PageHeader title="报表中心" desc="订单趋势、库存周转与费用分析" />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="库存周转天数" value={reportSummary.inventoryTurnover} sub="天" />
        <StatCard label="履约及时率" value={`${reportSummary.fulfillmentRate}%`} />
        <StatCard label="6月 GMV" value={formatCurrency(reportSummary.orderTrend[3].gmv)} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card padding>
          <h3 className="mb-4 text-sm font-semibold text-text-primary">订单量趋势</h3>
          <div className="space-y-3">
            {reportSummary.orderTrend.map(t => (
              <div key={t.month}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-text-secondary">{t.month}</span>
                  <span className="font-semibold">{t.orders} 单 · {formatCurrency(t.gmv)}</span>
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
            {reportSummary.feeBreakdown.map(f => (
              <div key={f.type}>
                <div className="mb-1 flex justify-between text-xs">
                  <span>{f.type}</span><span className="font-semibold">{f.pct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-subtle">
                  <div className="h-full rounded-full bg-primary-400" style={{ width: `${f.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
