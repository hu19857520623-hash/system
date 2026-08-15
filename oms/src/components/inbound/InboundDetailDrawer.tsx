import { useState } from 'react'
import { X, Download, Printer } from 'lucide-react'
import { Badge, Button, MonoCode } from '../ui'
import {
  InboundOrder, DELIVERY_METHOD_LABELS, STOCK_SOURCE_LABELS, statusLabels,
} from '../../data/mockData'
import { INBOUND_DOWNLOAD_ITEMS } from '../../data/customerShipFlows'
import { downloadInboundLabelHtml, printInboundLabels, type InboundLabelKind } from '../../data/inboundLabelPrint'
import { getInboundOrdersSnapshot, setInboundOrders } from '../../data/entityStore'
import { apiDelete } from '../../api/client'

interface InboundDetailDrawerProps {
  order: InboundOrder | null
  onClose: () => void
  onOrderChanged?: () => void
}

const TIMELINE: Record<string, string[]> = {
  draft: ['草稿已保存'],
  on_the_way: ['已提交预约', '货物在途'],
  receiving: ['已提交预约', '仓库收货中'],
  partial: ['已提交预约', '部分收货'],
  completed: ['已提交预约', '收货完成'],
  shelved: ['已提交预约', '收货完成', '上架完成'],
  exception: ['已提交预约', '收货异常待处理'],
}

export default function InboundDetailDrawer({ order, onClose, onOrderChanged }: InboundDetailDrawerProps) {
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  if (!order) return null

  const timeline = TIMELINE[order.status] ?? ['已提交预约']

  const showFeedback = (type: 'ok' | 'err', text: string) => {
    setFeedback({ type, text })
    window.setTimeout(() => setFeedback(null), 4000)
  }

  const handlePrint = (kind: InboundLabelKind) => {
    if (printInboundLabels(order, kind)) {
      showFeedback('ok', `已打开${kind}打印预览`)
    }
  }

  const handleDownload = (kind: InboundLabelKind) => {
    downloadInboundLabelHtml(order, kind)
    showFeedback('ok', `已下载${kind} HTML 文件`)
  }

  const handleCancel = async () => {
    if (order.status === 'draft') {
      if (!window.confirm(`确认删除草稿入库单 ${order.inboundNo}？此操作不可恢复。`)) return
      const before = getInboundOrdersSnapshot()
      setInboundOrders(before.filter(o => o.id !== order.id))
      try {
        await apiDelete(`/inbound-orders/${encodeURIComponent(order.id)}`)
        showFeedback('ok', '草稿已删除')
        onOrderChanged?.()
        window.setTimeout(onClose, 300)
      } catch (error) {
        setInboundOrders(before)
        showFeedback('err', `删除失败：${error instanceof Error ? error.message : String(error)}`)
      }
      return
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/20 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-light px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-text-primary">预约入库详情</p>
            <MonoCode>{order.inboundNo}</MonoCode>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-text-muted hover:bg-surface-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {feedback && (
            <div className={`rounded-lg px-3 py-2 text-xs ${feedback.type === 'ok' ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100' : 'bg-red-50 text-red-800 ring-1 ring-red-100'}`}>
              {feedback.text}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Badge status={order.status} label={statusLabels[order.status]} />
            <span className="rounded-md bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-text-secondary">
              {STOCK_SOURCE_LABELS[order.stockSource]}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              ['目的仓库', order.warehouse],
              ['入库类型', order.inboundType],
              ['交货方式', DELIVERY_METHOD_LABELS[order.deliveryMethod]],
              ['预计到货', order.eta ?? '—'],
              ['跟踪号', order.trackingNo ?? '—'],
              ['参考号', order.referenceNo ?? '—'],
              ['联系人', order.contact ?? '—'],
              ['联系电话', order.contactPhone ?? '—'],
              ['箱数 / SKU', `${order.boxCount} 箱 · ${order.skuCount} SKU`],
              ['应收 / 实收', `${order.receivedQty} / ${order.totalQty}`],
            ].map(([k, v]) => (
              <div key={k}>
                <p className="text-[11px] text-text-muted">{k}</p>
                <p className="font-medium text-text-primary">{v}</p>
              </div>
            ))}
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold text-text-secondary">进度跟踪</p>
            <ul className="space-y-2">
              {timeline.map((step, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-text-secondary">
                  <span className={`h-2 w-2 rounded-full ${i === timeline.length - 1 ? 'bg-primary-500' : 'bg-emerald-400'}`} />
                  {step}
                </li>
              ))}
            </ul>
          </div>

          {['on_the_way', 'draft'].includes(order.status) && (
            <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-100">
              <p className="text-xs font-semibold text-amber-900">提交后请打印标签</p>
              <p className="mt-1 text-[11px] text-amber-800">下载或打印箱唛与 SKU 标签贴于外箱，便于海外仓识别收货</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {INBOUND_DOWNLOAD_ITEMS.map(l => (
                  <Button key={l} variant="secondary" size="sm" onClick={() => handlePrint(l as InboundLabelKind)}>
                    <Printer className="h-3 w-3" /> 打印{l}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border-light p-4 flex flex-wrap gap-2">
          {INBOUND_DOWNLOAD_ITEMS.map(l => (
            <Button key={l} variant="secondary" size="sm" onClick={() => handleDownload(l as InboundLabelKind)}>
              <Download className="h-3 w-3" />{l}
            </Button>
          ))}
          {order.status === 'draft' && (
            <Button variant="danger-outline" size="sm" className="ml-auto" onClick={() => void handleCancel()}>
              删除草稿
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
