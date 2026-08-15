import { useEffect, useState, useMemo } from 'react'
import {
  Badge, Button, Drawer, DrawerTabs, ExceptionBadge, InfoRow, MonoCode, SectionTitle,
} from '../ui'
import {
  formatCurrency, statusLabels,
  SHIPMENT_SOURCE_LABELS, STOCK_SOURCE_LABELS,
} from '../../data/mockData'
import type { FulfillmentRow } from '../../data/fulfillmentUtils'
import { updateOrder } from '../../data/entityStore'
import { updateOutboundOrder } from '../../data/outboundStore'
import { useBilling } from '../../data/billingStore'
import { buildOutboundFeeSummary } from '../../data/outboundFeeUtils'
import OutboundFeePanel from './OutboundFeePanel'
import type { LogisticsRecord } from '../../data/mockData'
import { PodStatusBadge, PodRowActions } from './PodReceiptModals'
import { AlertCircle, Package, MapPin, Clock } from 'lucide-react'

interface Props {
  row: FulfillmentRow | null
  open: boolean
  onClose: () => void
  onUploadPod?: (record: LogisticsRecord) => void
  onViewPod?: (record: LogisticsRecord) => void
}

export default function FulfillmentDetailDrawer({ row, open, onClose, onUploadPod, onViewPod }: Props) {
  const [tab, setTab] = useState('summary')
  const [exceptionReason, setExceptionReason] = useState('')
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const { feeRecords } = useBilling()

  useEffect(() => {
    if (!row) return
    setExceptionReason(row.order?.exceptionReason ?? row.outbound?.exceptionReason ?? '')
  }, [row?.id])

  const feeSummary = useMemo(
    () => (row?.outbound ? buildOutboundFeeSummary(row.outbound, feeRecords) : null),
    [row?.outbound, row?.id, feeRecords],
  )

  if (!row) return null

  const { order, outbound } = row

  const saveExceptionReason = () => {
    const reason = exceptionReason.trim()
    if (!window.confirm('确认将该单据标记为“异常”并保存备注？')) return
    if (order) {
      updateOrder(order.id, {
        exception: order.exception ?? 'sync_fail',
        exceptionReason: reason || undefined,
        status: order.status === 'exception' ? order.status : 'exception',
      })
    }
    if (outbound) {
      updateOutboundOrder(outbound.id, {
        status: 'exception',
        exceptionCode: order?.exception ?? 'manual',
        exceptionReason: reason || undefined,
      })
    }
    setFeedback({
      type: 'ok',
      text: reason
        ? '异常备注已保存；该单据状态已更新为异常，若当前列表按状态筛选，请切换到「异常」或「全部」查看。'
        : '异常备注已保存；该单据状态已更新为异常，若当前列表按状态筛选，请切换到「异常」或「全部」查看。',
    })
    window.setTimeout(() => setFeedback(null), 6000)
  }
  const tabs = [
    { id: 'summary', label: '概要' },
    ...(order ? [
      { id: 'items', label: '商品明细' },
      { id: 'tracking', label: '物流轨迹' },
      { id: 'logs', label: '操作日志' },
    ] : []),
    ...(feeSummary && (feeSummary.preDeductTotal > 0 || feeSummary.actualTotal > 0 || feeSummary.allRecords.length > 0)
      ? [{ id: 'fees', label: '费用明细' }]
      : []),
  ]

  const title = row.outboundNo

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      subtitle={
        <>
          <span className="text-xs text-text-muted">
            {row.platform}{row.store !== '—' ? ` · ${row.store}` : ''}
          </span>
          <Badge status={row.statusKey} label={row.statusLabel} />
          {order?.exception && <ExceptionBadge type={order.exception} />}
        </>
      }
    >
      <DrawerTabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="px-5 py-4">
        {feedback && (
          <div className={`mb-4 rounded-lg px-3 py-2 text-xs ${feedback.type === 'ok' ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100' : 'bg-red-50 text-red-800 ring-1 ring-red-100'}`}>
            {feedback.text}
          </div>
        )}
        {(order?.exception || outbound?.status === 'exception') && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl bg-red-50 px-4 py-3 ring-1 ring-red-100">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-red-800">
                异常：{order?.exception ? (statusLabels[order.exception] ?? order.exception) : (outbound?.exceptionCode ?? 'exception')}
              </p>
              {(order?.exceptionReason || outbound?.exceptionReason) && (
                <p className="mt-1 text-[11px] text-red-700">{order?.exceptionReason || outbound?.exceptionReason}</p>
              )}
            </div>
          </div>
        )}

        {tab === 'summary' && (
          <div className="space-y-6">
            <section>
              <SectionTitle>列表信息</SectionTitle>
              <InfoRow label="出库单号" value={<MonoCode>{row.outboundNo}</MonoCode>} />
              <InfoRow label="参考号" value={row.refNo ? <MonoCode>{row.refNo}</MonoCode> : '客户未填写'} />
              <InfoRow
                label="跟踪号/运单号"
                value={row.trackingNo ?? '待海外仓回传'}
              />
              {row.logistics && (
                <>
                  <InfoRow label="承运商" value={row.logistics.carrier || '—'} />
                  <InfoRow label="物流状态" value={statusLabels[row.logistics.status] ?? row.logistics.status} />
                  <InfoRow label="目的地" value={row.logistics.destination} />
                  <InfoRow label="物流更新" value={row.logistics.updatedAt} />
                  {row.logistics.podCode && (
                    <InfoRow label="仓库 POD 码" value={<MonoCode>{row.logistics.podCode}</MonoCode>} />
                  )}
                  <InfoRow
                    label="签收单 (POD)"
                    value={
                      <div className="flex items-center gap-2">
                        <PodStatusBadge status={row.logistics.podStatus} />
                        {onUploadPod && onViewPod && (
                          <PodRowActions
                            record={row.logistics}
                            onUpload={onUploadPod}
                            onView={onViewPod}
                          />
                        )}
                      </div>
                    }
                  />
                </>
              )}
              <InfoRow label="物流渠道" value={row.shippingMethod ?? '—'} />
              <InfoRow label="发货来源" value={row.source ? SHIPMENT_SOURCE_LABELS[row.source] : '—'} />
              <InfoRow label="平台" value={row.platform} />
              <InfoRow label="店铺" value={row.store} />
              <InfoRow label="仓库" value={row.warehouse} />
              <InfoRow label="履约状态" value={row.statusLabel} />
              <InfoRow label="金额" value={row.amount != null ? formatCurrency(row.amount) : '—'} />
              <InfoRow label="时间" value={row.createdAt} />
            </section>

            {outbound && (
              <section>
                <SectionTitle>出库详情</SectionTitle>
                <InfoRow label="出库类型" value={outbound.type} />
                <InfoRow label="目的地" value={outbound.destination} />
                <InfoRow label="预约送仓日" value={outbound.scheduledDeliveryDate ?? '—'} />
                <InfoRow label="备注" value={outbound.remark ?? '—'} />
                <InfoRow label="库存来源" value={STOCK_SOURCE_LABELS[outbound.stockSource]} />
                <InfoRow label="SKU 数" value={String(outbound.items)} />
                <InfoRow label="总数量" value={String(outbound.totalQty)} />
                {outbound.recipient && (
                  <>
                    <InfoRow label="收件人" value={`${outbound.recipient.name} · ${outbound.recipient.phone}`} />
                    <InfoRow
                      label="收件地址"
                      value={[
                        outbound.recipient.address1,
                        outbound.recipient.address2,
                        outbound.recipient.city,
                        outbound.recipient.province,
                        outbound.recipient.postalCode,
                      ].filter(Boolean).join(', ')}
                    />
                    <InfoRow label="收件邮箱" value={outbound.recipient.email || '—'} />
                  </>
                )}
                {outbound.lineItems && outbound.lineItems.length > 0 && (
                  <InfoRow
                    label="明细行"
                    value={outbound.lineItems.map(l => `${l.sku}×${l.qty}`).join('、')}
                  />
                )}
                {outbound.attachments && outbound.attachments.length > 0 && (
                  <InfoRow label="附件" value={`${outbound.attachments.length} 个文件`} />
                )}
                {outbound.destRegion && (
                  <InfoRow label="目的地区" value={outbound.destRegion.toUpperCase()} />
                )}
                {outbound.priceTemplateName && (
                  <InfoRow label="价格模板" value={outbound.priceTemplateName} />
                )}
                {feeSummary && (feeSummary.preDeductTotal > 0 || feeSummary.actualTotal > 0) && (
                  <InfoRow
                    label="费用概览"
                    value={<OutboundFeePanel summary={feeSummary} compact />}
                  />
                )}
              </section>
            )}

            <section>
              <SectionTitle>异常原因备注</SectionTitle>
              <textarea
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-xs"
                rows={3}
                placeholder="填写异常原因，便于转移与复核"
                value={exceptionReason}
                onChange={e => setExceptionReason(e.target.value)}
              />
              <div className="mt-2 flex justify-end">
                <Button size="sm" onClick={saveExceptionReason}>保存异常备注</Button>
              </div>
            </section>

            {order && (
              <section>
                <SectionTitle>收件信息</SectionTitle>
                <InfoRow label="订单号" value={<MonoCode>{order.orderNo}</MonoCode>} />
                <InfoRow label="收件人" value={order.recipient} />
                <InfoRow label="地址" value={order.address} />
                <InfoRow label="SKU 数" value={String(order.skuCount)} />
              </section>
            )}
          </div>
        )}

        {tab === 'items' && order && (
          <div className="space-y-3">
            {order.items.map(item => (
              <div key={item.sku} className="flex gap-3 rounded-xl border border-border-light p-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-muted">
                  <Package className="h-4 w-4 text-text-muted" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary">{item.name}</p>
                  <p className="text-xs text-text-muted"><MonoCode>{item.sku}</MonoCode></p>
                  <p className="mt-1 text-xs text-text-muted">
                    × {item.qty} · {formatCurrency(item.price)}
                    {!item.stockOk && <span className="ml-2 text-red-600">库存不足</span>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'tracking' && order && (
          <div className="space-y-0">
            {order.tracking.length === 0 ? (
              <p className="py-8 text-center text-sm text-text-muted">暂无物流轨迹</p>
            ) : order.tracking.map((t, i) => (
              <div key={i} className="flex gap-3 pb-4">
                <div className="flex flex-col items-center">
                  <div className={`h-2.5 w-2.5 rounded-full ${i === 0 ? 'bg-primary-500' : 'bg-border'}`} />
                  {i < order.tracking.length - 1 && <div className="w-px flex-1 bg-border" />}
                </div>
                <div className="pb-2">
                  <p className="text-sm font-medium text-text-primary">{t.desc}</p>
                  {t.location && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-text-muted">
                      <MapPin className="h-3 w-3" /> {t.location}
                    </p>
                  )}
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-text-muted">
                    <Clock className="h-3 w-3" /> {t.time}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'fees' && feeSummary && (
          <OutboundFeePanel summary={feeSummary} />
        )}

        {tab === 'logs' && order && (
          <div className="space-y-2">
            {order.logs.map((log, i) => (
              <div key={i} className="flex items-start justify-between gap-3 border-b border-border-light py-2 text-xs last:border-0">
                <div>
                  <p className="font-medium text-text-primary">{log.action}</p>
                  <p className="text-text-muted">{log.user}</p>
                </div>
                <span className="shrink-0 text-text-muted">{log.time}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  )
}
