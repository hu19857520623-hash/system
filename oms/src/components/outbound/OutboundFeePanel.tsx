import { formatCurrency } from '../../data/mockData'
import type { OutboundFeeSummary } from '../../data/outboundFeeUtils'
import { settlementStatusLabel } from '../../data/outboundFeeUtils'
import { Badge } from '../ui'

interface Props {
  summary: OutboundFeeSummary
  compact?: boolean
}

function MethodBadge({ method }: { method?: string }) {
  if (method === 'pre_deduct') {
    return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-800">预扣</span>
  }
  if (method === 'actual') {
    return <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-medium text-sky-800">实扣</span>
  }
  if (method === 'settlement_adjust') {
    return <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-medium text-violet-800">对账</span>
  }
  return null
}

function formatTimestamp(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

/** P6-4：出库费用闭环展示（预扣 → 实测 → 实扣 → 对账） */
export default function OutboundFeePanel({ summary, compact }: Props) {
  const {
    preDeductTotal,
    actualTotal,
    settlementDelta,
    settlementStatus,
    preDeductVolumeM3,
    preDeductWeightKg,
    measuredVolumeM3,
    measuredWeightKg,
    cartons,
    measuredAt,
    calculatedAt,
    preDeductLines,
    actualLines,
    settlementLines,
  } = summary

  const hasMeasure =
    preDeductVolumeM3 != null ||
    preDeductWeightKg != null ||
    measuredVolumeM3 != null ||
    measuredWeightKg != null

  const statusBadge =
    settlementStatus === 'settled' ? 'available' :
    settlementStatus === 'refunded' ? 'shipped' :
    settlementStatus === 'pending' ? 'reviewing' : 'locked'

  if (compact) {
    return (
      <div className="space-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-text-muted">预扣 {formatCurrency(preDeductTotal)}</span>
          {actualTotal > 0 && (
            <>
              <span className="text-text-muted">→</span>
              <span className="text-text-muted">实扣 {formatCurrency(actualTotal)}</span>
            </>
          )}
          {settlementDelta != null && settlementStatus === 'settled' && (
            <span className={settlementDelta === 0 ? 'text-emerald-600' : settlementDelta > 0 ? 'text-orange-600' : 'text-emerald-600'}>
              {settlementDelta === 0 ? '平账' : settlementDelta > 0 ? `补扣 ${formatCurrency(settlementDelta)}` : `退还 ${formatCurrency(Math.abs(settlementDelta))}`}
            </span>
          )}
          {settlementStatus && (
            <Badge status={statusBadge} label={settlementStatusLabel(settlementStatus)} />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {settlementStatus && (
        <div className="flex items-center justify-between rounded-lg bg-surface-muted/40 px-3 py-2">
          <span className="text-xs text-text-secondary">对账状态</span>
          <Badge status={statusBadge} label={settlementStatusLabel(settlementStatus)} />
        </div>
      )}

      {/* 试算预扣 */}
      {(preDeductLines.length > 0 || preDeductTotal > 0) && (
        <section>
          <p className="mb-2 text-[11px] font-semibold text-amber-800">① 提交试算 · 预扣</p>
          <div className="space-y-1.5">
            {preDeductLines.map((line, i) => (
              <div key={i} className="flex items-start justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm ring-1 ring-amber-100">
                <div className="min-w-0">
                  <span className="text-text-secondary">{line.label}</span>
                  {line.detail && <p className="mt-0.5 text-[10px] text-text-muted">{line.detail}</p>}
                </div>
                <span className="shrink-0 font-semibold text-amber-900">{formatCurrency(line.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between px-1 text-xs font-semibold text-amber-900">
              <span>预扣合计</span>
              <span>{formatCurrency(preDeductTotal)}</span>
            </div>
          </div>
        </section>
      )}

      {/* 实测数据 */}
      {hasMeasure && (
        <section>
          <p className="mb-2 text-[11px] font-semibold text-text-secondary">② ERP 实测</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-surface-muted/50 px-3 py-2 ring-1 ring-border-light">
              <p className="text-text-muted">体积 (试算 / 实测)</p>
              <p className="mt-1 font-medium text-text-primary">
                {preDeductVolumeM3?.toFixed(4) ?? '—'} / {measuredVolumeM3?.toFixed(4) ?? '—'} m³
              </p>
            </div>
            <div className="rounded-lg bg-surface-muted/50 px-3 py-2 ring-1 ring-border-light">
              <p className="text-text-muted">重量 (试算 / 实测)</p>
              <p className="mt-1 font-medium text-text-primary">
                {preDeductWeightKg?.toFixed(2) ?? '—'} / {measuredWeightKg?.toFixed(2) ?? '—'} kg
              </p>
            </div>
          </div>
          {(measuredAt || calculatedAt) && (
            <p className="mt-2 text-[10px] text-text-muted">
              {measuredAt ? `实测：${formatTimestamp(measuredAt)}` : ''}
              {measuredAt && calculatedAt ? ' · ' : ''}
              {calculatedAt ? `实算：${formatTimestamp(calculatedAt)}` : ''}
            </p>
          )}
          {cartons.length > 0 && (
            <div className="mt-2 overflow-hidden rounded-lg ring-1 ring-border-light">
              {cartons.map(carton => (
                <div key={carton.cartonNo} className="flex flex-wrap items-center justify-between gap-2 border-b border-border-light px-3 py-2 text-[11px] last:border-0">
                  <span className="font-medium text-text-secondary">箱 {carton.cartonNo}</span>
                  <span className="text-text-muted">
                    {carton.lengthCm} × {carton.widthCm} × {carton.heightCm} cm
                  </span>
                  <span className="text-text-muted">{carton.grossWeightKg.toFixed(2)} kg</span>
                  <span className="font-medium text-text-primary">{carton.volumeCbm.toFixed(6)} m³</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 实扣明细 */}
      {(actualLines.length > 0 || actualTotal > 0) && (
        <section>
          <p className="mb-2 text-[11px] font-semibold text-sky-800">③ ERP 发运 · 实扣</p>
          <div className="space-y-1.5">
            {actualLines.length > 0 ? actualLines.map((line, i) => (
              <div key={i} className="flex items-start justify-between gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm ring-1 ring-sky-100">
                <div className="min-w-0">
                  <span className="text-text-secondary">{line.label}</span>
                  <p className="mt-0.5 line-clamp-2 text-[10px] text-text-muted">{line.desc}</p>
                </div>
                <span className="shrink-0 font-semibold text-sky-900">{formatCurrency(line.amount)}</span>
              </div>
            )) : (
              <div className="flex justify-between rounded-lg bg-sky-50 px-3 py-2 text-sm ring-1 ring-sky-100">
                <span className="text-text-secondary">实测实算合计</span>
                <span className="font-semibold text-sky-900">{formatCurrency(actualTotal)}</span>
              </div>
            )}
            <div className="flex justify-between px-1 text-xs font-semibold text-sky-900">
              <span>实扣合计</span>
              <span>{formatCurrency(actualTotal)}</span>
            </div>
          </div>
        </section>
      )}

      {/* 对账结果 */}
      {(settlementDelta != null || settlementLines.length > 0) && (
        <section>
          <p className="mb-2 text-[11px] font-semibold text-violet-800">④ 预扣 vs 实扣 · 对账</p>
          {settlementDelta != null && settlementStatus === 'settled' && (
            <div className={`mb-2 flex items-center justify-between rounded-lg px-3 py-2.5 text-sm ring-1 ${
              settlementDelta === 0
                ? 'bg-emerald-50 ring-emerald-100'
                : settlementDelta > 0
                  ? 'bg-orange-50 ring-orange-100'
                  : 'bg-emerald-50 ring-emerald-100'
            }`}>
              <span className="text-text-secondary">差额（实扣 − 预扣）</span>
              <span className="font-bold">
                {settlementDelta === 0
                  ? '平账'
                  : settlementDelta > 0
                    ? `补扣 ${formatCurrency(settlementDelta)}`
                    : `退还 ${formatCurrency(Math.abs(settlementDelta))}`}
              </span>
            </div>
          )}
          {settlementLines.map(f => (
            <div key={f.id} className="flex items-start justify-between gap-2 rounded-lg bg-violet-50/60 px-3 py-2 text-sm ring-1 ring-violet-100">
              <div className="min-w-0 flex items-center gap-1.5">
                <MethodBadge method={f.method} />
                <span className="text-text-secondary">{f.desc}</span>
              </div>
              <span className={`shrink-0 font-semibold ${f.amount > 0 ? 'text-emerald-600' : 'text-text-primary'}`}>
                {f.amount > 0 ? '+' : '-'}{formatCurrency(Math.abs(f.amount))}
              </span>
            </div>
          ))}
        </section>
      )}

      {preDeductTotal <= 0 && actualTotal <= 0 && !hasMeasure && (
        <p className="py-6 text-center text-sm text-text-muted">暂无费用数据</p>
      )}
    </div>
  )
}
