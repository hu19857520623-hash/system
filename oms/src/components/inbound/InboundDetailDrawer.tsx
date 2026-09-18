import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { X, Download, Printer } from 'lucide-react'
import { Badge, Button, MonoCode } from '../ui'
import {
  InboundOrder, DELIVERY_METHOD_LABELS, STOCK_SOURCE_LABELS, statusLabels,
  customerInboundTypeLabel, customerInboundStockLabel,
} from '../../data/mockData'
import { useRole } from '../../auth/RoleContext'
import { isSysAdmin } from '../../data/dataScope'
import { INBOUND_DOWNLOAD_ITEMS } from '../../data/customerShipFlows'
import { downloadInboundLabelHtml, printInboundLabels, type InboundLabelKind } from '../../data/inboundLabelPrint'
import { downloadInboundReceivingList, printInboundReceivingList } from '../../data/inboundReceivingListPrint'
import { useProducts } from '../../data/inventoryStore'
import { getInboundOrdersSnapshot, setInboundOrders } from '../../data/entityStore'
import { apiDelete } from '../../api/client'
import { canEditInboundOrder, canVoidInboundOrder, canReorderInboundOrder, voidInboundOrder, reorderInboundOnErp } from '../../data/inboundStore'

interface InboundDetailDrawerProps {
  order: InboundOrder | null
  onClose: () => void
  onOrderChanged?: (order?: InboundOrder | null) => void
}

const TIMELINE: Record<string, string[]> = {
  draft: ['草稿已保存'],
  on_the_way: ['已提交预约', '货物在途'],
  receiving: ['已提交预约', '仓库收货中'],
  partial: ['已提交预约', '部分收货'],
  completed: ['已提交预约', '收货完成'],
  shelved: ['已提交预约', '收货完成', '上架完成'],
  exception: ['已提交预约', '收货异常待处理'],
  voided: ['已作废', '可重新下单'],
}

export default function InboundDetailDrawer({ order, onClose, onOrderChanged }: InboundDetailDrawerProps) {
  const { role } = useRole()
  const customerView = !isSysAdmin(role)
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [voiding, setVoiding] = useState(false)
  const [reordering, setReordering] = useState(false)
  const [confirmReorder, setConfirmReorder] = useState(false)
  const products = useProducts()

  useEffect(() => {
    setConfirmReorder(false)
    setFeedback(null)
  }, [order?.id])

  if (!order) return null

  const timeline = TIMELINE[order.status] ?? ['已提交预约']

  const showFeedback = (type: 'ok' | 'err', text: string) => {
    setFeedback({ type, text })
    window.setTimeout(() => setFeedback(null), 4000)
  }

  const handlePrint = async (kind: InboundLabelKind) => {
    const ok = await printInboundLabels(order, kind)
    if (ok) {
      showFeedback('ok', `已打开${kind}打印预览`)
    }
  }

  const handleDownloadReceivingList = () => {
    downloadInboundReceivingList(order, products)
    showFeedback('ok', '已下载入库清单')
  }

  const handlePrintReceivingList = () => {
    if (printInboundReceivingList(order, products)) {
      showFeedback('ok', '已打开入库清单打印预览')
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

  const handleVoid = async () => {
    if (!canVoidInboundOrder(order.status)) return
    if (!window.confirm(`确认作废入库单 ${order.inboundNo}？作废后仓库不再收货，可在详情中确认后重新下单。`)) return
    setVoiding(true)
    try {
      const result = await voidInboundOrder(order)
      if (!result.ok) {
        showFeedback('err', `作废失败：${result.error}`)
        return
      }
      showFeedback('ok', '入库单已作废，可确认内容后重新下单')
      onOrderChanged?.(result.order)
    } finally {
      setVoiding(false)
    }
  }

  const handleReorderSubmit = async () => {
    if (!canReorderInboundOrder(order.status)) return
    if (!confirmReorder) {
      showFeedback('err', '请先确认入库单内容后再提交')
      return
    }
    setReordering(true)
    try {
      const result = await reorderInboundOnErp(order)
      if (!result.ok) {
        showFeedback('err', `重新下单失败：${result.error}`)
        return
      }
      showFeedback('ok', '已重新下单，进入在途')
      onOrderChanged?.(result.order)
      window.setTimeout(onClose, 400)
    } finally {
      setReordering(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/20 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl"
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
              {customerView ? customerInboundStockLabel(order.stockSource) : STOCK_SOURCE_LABELS[order.stockSource]}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              ['目的仓库', order.warehouse],
              ['入库类型', customerView ? customerInboundTypeLabel(order.inboundType) : order.inboundType],
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

          {order.remark ? (
            <div>
              <p className="mb-1 text-xs font-semibold text-text-secondary">备注</p>
              <p className="whitespace-pre-wrap text-sm text-text-primary">{order.remark}</p>
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-xs font-semibold text-text-secondary">货品明细</p>
            {order.lineItems?.length ? (
              <div className="overflow-hidden rounded-lg ring-1 ring-border-light">
                <table className="w-full text-xs">
                  <thead className="bg-surface-muted text-text-muted">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">箱号</th>
                      <th className="px-2 py-1.5 text-left font-medium">SKU</th>
                      <th className="px-2 py-1.5 text-left font-medium">产品</th>
                      <th className="px-2 py-1.5 text-right font-medium">数量</th>
                      <th className="px-2 py-1.5 text-left font-medium">包装</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.lineItems.map((line, index) => (
                      <tr key={`${line.sku}-${line.boxNo}-${index}`} className="border-t border-border-light">
                        <td className="px-2 py-1.5 text-text-secondary">{line.boxNo}</td>
                        <td className="px-2 py-1.5"><MonoCode>{line.sku}</MonoCode></td>
                        <td className="px-2 py-1.5 text-text-primary">{line.name}</td>
                        <td className="px-2 py-1.5 text-right font-semibold text-text-primary">{line.qty}</td>
                        <td className="px-2 py-1.5 text-text-secondary">{line.packType || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-text-muted">{order.skuHint || '暂无明细'}</p>
            )}
          </div>

          {order.attachments?.length ? (
            <div>
              <p className="mb-1 text-xs font-semibold text-text-secondary">附件</p>
              <ul className="space-y-1 text-xs text-text-secondary">
                {order.attachments.map((file, index) => (
                  <li key={`${file.fileName}-${index}`}>{file.fileName}</li>
                ))}
              </ul>
            </div>
          ) : null}

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

          {canReorderInboundOrder(order.status) && (
            <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-border-light">
              <p className="text-xs font-semibold text-text-primary">重新下单</p>
              <p className="mt-1 text-[11px] text-text-secondary">请先核对上方入库信息与货品明细，确认无误后再提交，提交后进入在途。</p>
              <label className="mt-3 flex items-start gap-2 text-xs text-text-primary">
                <input
                  type="checkbox"
                  checked={confirmReorder}
                  onChange={e => setConfirmReorder(e.target.checked)}
                  className="mt-0.5 rounded border-border text-primary-600"
                />
                确认按此入库单内容重新下单
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" disabled={!confirmReorder || reordering} onClick={() => void handleReorderSubmit()}>
                  {reordering ? '提交中…' : '提交'}
                </Button>
                <Link to={`/inbound?reorder=${encodeURIComponent(order.id)}`}>
                  <Button variant="secondary" size="sm">修改后提交</Button>
                </Link>
              </div>
            </div>
          )}

          {['on_the_way', 'draft'].includes(order.status) && (
            <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-100">
              <p className="text-xs font-semibold text-amber-900">提交后请打印入库清单与标签</p>
              <p className="mt-1 text-[11px] text-amber-800">在途即可下载入库清单做人工清点；箱唛与 SKU 标签贴于外箱，便于海外仓收货</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {order.status !== 'draft' && (
                  <Button variant="secondary" size="sm" onClick={handlePrintReceivingList}>
                    <Printer className="h-3 w-3" /> 打印入库清单
                  </Button>
                )}
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
          {canEditInboundOrder(order.status) && (
            <Link to={`/inbound?edit=${encodeURIComponent(order.id)}`}>
              <Button size="sm">{order.status === 'draft' ? '编辑' : '修改'}</Button>
            </Link>
          )}
          {!['draft', 'voided'].includes(order.status) && (
            <Button variant="secondary" size="sm" onClick={handleDownloadReceivingList}>
              <Download className="h-3 w-3" />入库清单
            </Button>
          )}
          {order.status !== 'voided' && INBOUND_DOWNLOAD_ITEMS.map(l => (
            <Button key={l} variant="secondary" size="sm" onClick={() => handleDownload(l as InboundLabelKind)}>
              <Download className="h-3 w-3" />{l}
            </Button>
          ))}
          {canVoidInboundOrder(order.status) && (
            <Button variant="danger-outline" size="sm" disabled={voiding} onClick={() => void handleVoid()}>
              {voiding ? '作废中…' : '作废'}
            </Button>
          )}
          {canReorderInboundOrder(order.status) && (
            <Button size="sm" disabled={!confirmReorder || reordering} onClick={() => void handleReorderSubmit()}>
              {reordering ? '提交中…' : '提交'}
            </Button>
          )}
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
