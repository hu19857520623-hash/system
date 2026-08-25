import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { RefreshCw, Plus } from 'lucide-react'
import { Badge, Button, Card, MonoCode, PageHeader, Table, TableFooter } from '../components/ui'
import { DropdownBtn } from '../components/ui/filters'
import { useReturnOrders } from '../data/entityStore'
import {
  RETURN_STATUS_LABELS,
  RETURN_PROCESS_OPTIONS,
  addReturnOrder,
  nextReturnNo,
  refreshReturnsFromErp,
  removeReturnOrder,
  withdrawReturnOrder,
  decideReturnOrder,
} from '../data/returnStore'
import { formatDatetimeDisplay, todayDateInput } from '../data/fileUtils'
import { importCsvFile } from '../data/csvImportExport'
import {
  RETURN_ORDER_COLUMNS,
  downloadReturnOrderTemplate,
  parseReturnOrders,
} from '../data/importTemplates'
import { useRole } from '../auth/RoleContext'
import { useDataScope } from '../auth/useDataScope'
import { getCustomerCode, getCustomerIdForRole, resolveErpCustomerContext } from '../data/dataScope'
import { AdminCustomerFilter } from '../components/admin/AdminCustomerFilter'
import { notifyIfUserError } from '../utils/userNotify'

type Tab = 'all' | 'draft' | 'pending_arrival' | 'awaiting_customer' | 'arrived' | 'completed' | 'cancelled'

function formatReturnFee(v?: number | null) {
  if (v == null) return '—'
  return `${Number(v).toFixed(2)} RMB`
}

const tabLabels: Record<Tab, string> = {
  all: '全部',
  draft: '草稿',
  pending_arrival: '待到货',
  awaiting_customer: '待确认',
  arrived: '已到货',
  completed: '已完成',
  cancelled: '已撤回',
}

export default function ReturnProcessing() {
  const { role, can } = useRole()
  const dataScope = useDataScope()
  const [searchParams] = useSearchParams()
  const allReturns = useReturnOrders()
  const initialTab = (searchParams.get('tab') as Tab | null)
  const [tab, setTab] = useState<Tab>(initialTab && initialTab in tabLabels ? initialTab : 'all')
  const [syncing, setSyncing] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)
  const [decideProcess, setDecideProcess] = useState('restock')

  const erpCustomer = resolveErpCustomerContext({
    role,
    customerId: dataScope.activeCustomerId,
    adminCustomerFilter: dataScope.customerFilter,
    accounts: dataScope.customerOptions,
  })

  const returns = useMemo(() => {
    let list = allReturns
    if (!dataScope.isAdmin && dataScope.activeCustomerId) {
      list = list.filter(r => r.customerId === dataScope.activeCustomerId)
    }
    if (tab !== 'all') list = list.filter(r => r.status === tab)
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [allReturns, dataScope, tab])

  const detail = returns.find(r => r.id === detailId) || allReturns.find(r => r.id === detailId)

  const handleSync = async () => {
    const customerId = getCustomerIdForRole(role)
    if (!customerId) {
      window.alert('请切换到客户角色后再同步 ERP 退件状态')
      return
    }
    setSyncing(true)
    try {
      const n = await refreshReturnsFromErp(customerId)
      window.alert(`已从 ERP 同步 ${n} 条退件状态`)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncing(false)
    }
  }

  const handleWithdraw = async (r: typeof returns[0]) => {
    if (!window.confirm(`确认撤回退件单 ${r.returnNo}？撤回后仓库将不再等待到货。`)) return
    setActingId(r.id)
    try {
      const result = await withdrawReturnOrder(r, {
        customerId: r.customerId || erpCustomer?.customerId,
        customerCode: erpCustomer?.customerCode || getCustomerCode(r.customerId),
      })
      if (!result.ok) {
        window.alert(result.error)
        return
      }
      window.alert('已撤回；可在「已撤回」标签页查看该退件单')
      if (detailId === r.id) setDetailId(null)
    } finally {
      setActingId(null)
    }
  }

  const handleDelete = (r: typeof returns[0]) => {
    if (!window.confirm(`确认删除退件单 ${r.returnNo}？此操作不可恢复。`)) return
    const result = removeReturnOrder(r)
    if (!result.ok) {
      window.alert(result.error)
      return
    }
    if (detailId === r.id) setDetailId(null)
  }

  const canWrite = can('returns:write')

  const handleBulkImport = async () => {
    if (!canWrite) return
    try {
      const { data, errors } = await importCsvFile(RETURN_ORDER_COLUMNS, parseReturnOrders)
      if (errors.length > 0) {
        window.alert(`导入失败：\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? `\n…共 ${errors.length} 条` : ''}`)
        return
      }
      if (data.length === 0) {
        window.alert('未解析到有效退件单，请使用最新模板')
        return
      }

      const customerId = erpCustomer?.customerId ?? getCustomerIdForRole(role) ?? undefined
      if (dataScope.isAdmin && !customerId) {
        window.alert('请先在上方选择要代操作的客户端，再批量导入退件')
        return
      }

      for (const order of data) {
        const totalQty = order.lineItems.reduce((s, l) => s + l.qty, 0)
        addReturnOrder({
          id: `rt-import-${Date.now()}-${order.headerKey}`,
          customerId,
          returnNo: nextReturnNo(),
          orderNo: order.orderNo.trim(),
          referenceNo: order.referenceNo,
          trackingNo: order.trackingNo,
          sellerStoreName: order.sellerStoreName,
          sellerTaxNo: order.sellerTaxNo,
          returnWarehouse: order.returnWarehouse,
          expectedArrivalAt: order.expectedArrivalAt,
          returnReason: order.returnReason,
          returnDescription: order.returnDescription,
          requestedProcess: order.requestedProcess,
          status: 'draft',
          statusLabel: '草稿',
          createdAt: todayDateInput(),
          lineItems: order.lineItems,
          totalQty,
          remark: order.remark,
        })
      }

      window.alert(`已导入 ${data.length} 张退件预约单（草稿），请在列表中核对后提交`)
      setTab('draft')
    } catch (err) {
      notifyIfUserError(err, '导入失败')
    }
  }

  const handleDecide = async (r: typeof returns[0], decision: 'keep' | 'discard') => {
    const msg = decision === 'discard'
      ? `确认不留货并销毁退件单 ${r.returnNo}？将产生销毁相关费用。`
      : `确认留货并授权处理退件单 ${r.returnNo}？将按所选方式追加费用。`
    if (!window.confirm(msg)) return
    setActingId(r.id)
    try {
      const result = await decideReturnOrder(r, decision, {
        customerId: r.customerId || erpCustomer?.customerId,
        customerCode: erpCustomer?.customerCode || getCustomerCode(r.customerId),
        processChoice: decision === 'keep' ? decideProcess : undefined,
      })
      if (!result.ok) {
        window.alert(result.error)
        return
      }
      window.alert(decision === 'discard' ? '已确认不留，仓库将销毁' : '已确认留货，仓库将安排作业')
      if (detailId === r.id) setDetailId(null)
    } finally {
      setActingId(null)
    }
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="退件处理"
        desc={dataScope.isAdmin ? '全平台退件单，查看仓库收货与处理结果' : '查看海外仓收货进度与 ERP 处理结果（重新上架 / 待检查 / 换标 / 等问题）'}
        action={(
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={syncing} onClick={() => void handleSync()}>
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} /> 同步 ERP
            </Button>
            {canWrite && (
              <>
                <DropdownBtn label="批量导入" items={[
                  { label: '上传退件预约单', onClick: () => void handleBulkImport() },
                  { label: '下载导入模板', onClick: downloadReturnOrderTemplate },
                ]} />
                <Link to="/returns/apply">
                  <Button size="sm"><Plus className="h-3.5 w-3.5" /> 预约退件</Button>
                </Link>
              </>
            )}
          </div>
        )}
      />

      {dataScope.isAdmin && (
        <Card className="mb-4 p-4">
          <AdminCustomerFilter scope={dataScope} />
          <p className="mt-2 text-xs text-text-muted">管理员批量导入退件前，请先选择客户端</p>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(tabLabels) as Tab[]).map(key => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
              tab === key
                ? 'bg-primary-50 text-primary-700 ring-primary-200'
                : 'bg-white text-text-secondary ring-border hover:bg-surface-muted'
            }`}
          >
            {tabLabels[key]}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <Table>
          <thead className="table-head">
            <tr>
              <th>退件单号</th>
              <th>订单号</th>
              <th>退件仓库</th>
              <th>参考号</th>
              <th>跟踪号</th>
              <th>SKU</th>
              <th>数量</th>
              <th>退件原因</th>
              <th>期望处理</th>
              <th>费用 (RMB)</th>
              <th>状态</th>
              <th>处理结果</th>
              <th>创建日期</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody className="table-body">
            {returns.map(r => {
              const skuLabel = r.lineItems.length === 1
                ? r.lineItems[0].sku
                : r.lineItems.length ? `${r.lineItems[0]?.sku} 等 ${r.lineItems.length} SKU` : '—'
              return (
                <tr
                  key={r.id}
                  className="table-row cursor-pointer hover:bg-surface-muted/60"
                  onClick={() => setDetailId(r.id)}
                >
                  <td className="table-cell"><MonoCode>{r.returnNo}</MonoCode></td>
                  <td className="table-cell"><MonoCode>{r.orderNo}</MonoCode></td>
                  <td className="table-cell text-xs">{r.returnWarehouse || '—'}</td>
                  <td className="table-cell text-xs">{r.referenceNo || '—'}</td>
                  <td className="table-cell text-xs">{r.trackingNo || '—'}</td>
                  <td className="table-cell text-xs"><MonoCode>{skuLabel}</MonoCode></td>
                  <td className="table-cell text-xs">{r.totalQty ?? r.lineItems.reduce((s, i) => s + i.qty, 0)}</td>
                  <td className="table-cell text-xs text-text-secondary">{r.returnReason}</td>
                  <td className="table-cell text-xs">{r.requestedProcessLabel || r.requestedProcess}</td>
                  <td className="table-cell text-xs">
                    {formatReturnFee(r.estimatedFeeTotal)}
                  </td>
                  <td className="table-cell">
                    <Badge status={r.status} label={r.statusLabel || RETURN_STATUS_LABELS[r.status] || r.status} />
                  </td>
                  <td className="table-cell text-xs">
                    {r.status === 'completed'
                      ? (r.processResultLabel || r.processResult || '—')
                      : '—'}
                  </td>
                  <td className="table-cell text-xs text-text-muted">{r.createdAt}</td>
                  <td className="table-cell" onClick={e => e.stopPropagation()}>
                    <div className="flex flex-wrap gap-2">
                      {canWrite && r.status === 'draft' && (
                        <>
                          <Link to={`/returns/apply?edit=${r.id}`} className="text-xs text-primary-600 hover:underline">
                            编辑
                          </Link>
                          <button
                            type="button"
                            className="text-xs text-red-600 hover:underline"
                            onClick={() => handleDelete(r)}
                          >
                            删除
                          </button>
                        </>
                      )}
                      {canWrite && r.status === 'awaiting_customer' && (
                        <button
                          type="button"
                          className="text-xs text-primary-600 hover:underline"
                          onClick={() => { setDecideProcess(r.requestedProcess || 'restock'); setDetailId(r.id) }}
                        >
                          确认留/不留
                        </button>
                      )}
                      {canWrite && r.status === 'pending_arrival' && (
                        <button
                          type="button"
                          className="text-xs text-amber-600 hover:underline disabled:opacity-50"
                          disabled={actingId === r.id}
                          onClick={() => void handleWithdraw(r)}
                        >
                          {actingId === r.id ? '撤回中…' : '撤回'}
                        </button>
                      )}
                      {canWrite && r.status === 'cancelled' && (
                        <>
                          <Link to={`/returns/apply?edit=${r.id}`} className="text-xs text-primary-600 hover:underline">
                            重新编辑
                          </Link>
                          <button
                            type="button"
                            className="text-xs text-red-600 hover:underline"
                            onClick={() => handleDelete(r)}
                          >
                            删除
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {returns.length === 0 && (
              <tr><td colSpan={14} className="table-cell py-10 text-center text-sm text-text-muted">暂无退件记录</td></tr>
            )}
          </tbody>
        </Table>
        <TableFooter total={returns.length} />
      </Card>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setDetailId(null)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-text-primary">退件详情</p>
                <p className="mt-1 text-xs text-text-muted"><MonoCode>{detail.returnNo}</MonoCode></p>
              </div>
              <button type="button" className="text-sm text-text-muted hover:text-text-primary" onClick={() => setDetailId(null)}>关闭</button>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              {[
                ['订单号', detail.orderNo],
                ['参考号', detail.referenceNo || '—'],
                ['跟踪号', detail.trackingNo || '—'],
                ['退件仓库', detail.returnWarehouse || '—'],
                ['卖家店铺', detail.sellerStoreName || '—'],
                ['卖家税号', detail.sellerTaxNo || '—'],
                ['预计到货', formatDatetimeDisplay(detail.expectedArrivalAt)],
                ['退件原因', detail.returnReason],
                ['期望处理', detail.requestedProcessLabel || detail.requestedProcess],
                ['当前状态', detail.statusLabel || RETURN_STATUS_LABELS[detail.status] || detail.status],
                ['体积 CBM', detail.totalVolumeCbm != null ? String(detail.totalVolumeCbm) : '—'],
                ['预估费用', formatReturnFee(detail.estimatedFeeTotal)],
                ['质检结论', detail.inspectionResultLabel || detail.inspectionResult || '—'],
                ['收货时间', detail.receivedAt || '—'],
                ['处理结果', detail.processResultLabel || detail.processResult || '—'],
                ['处理时间', detail.processedAt || '—'],
              ].map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-text-muted">{k}</dt>
                  <dd className="text-text-primary">{v}</dd>
                </div>
              ))}
            </dl>
            {detail.returnDescription && (
              <p className="mt-3 text-xs text-text-secondary"><span className="text-text-muted">退件说明：</span>{detail.returnDescription}</p>
            )}
            {detail.processRemark && (
              <p className="mt-2 text-xs text-text-secondary"><span className="text-text-muted">仓库处理备注：</span>{detail.processRemark}</p>
            )}
            {detail.inspectionRemark && (
              <p className="mt-2 text-xs text-text-secondary"><span className="text-text-muted">质检说明：</span>{detail.inspectionRemark}</p>
            )}
            {detail.inspectionPhotos && detail.inspectionPhotos.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium text-text-secondary">仓库质检照片</p>
                <ul className="space-y-1 text-xs">
                  {detail.inspectionPhotos.map(a => (
                    <li key={`${a.fileName}-${a.uploadedAt}`}>
                      <a href={a.url} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">{a.fileName}</a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {detail.attachments && detail.attachments.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium text-text-secondary">附件</p>
                <ul className="space-y-1 text-xs">
                  {detail.attachments.map(a => (
                    <li key={`${a.fileName}-${a.uploadedAt}`}>
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        download={a.fileName}
                        className="text-primary-600 hover:underline"
                      >
                        {a.fileName}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-text-secondary">SKU 明细</p>
              <ul className="space-y-1 text-xs">
                {detail.lineItems.map(l => (
                  <li key={l.sku} className="flex justify-between rounded bg-surface-muted px-2 py-1">
                    <span><MonoCode>{l.sku}</MonoCode> · {l.name}</span>
                    <span>×{l.qty}</span>
                  </li>
                ))}
              </ul>
            </div>
            {canWrite && (
              <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
                {detail.status === 'draft' && (
                  <>
                    <Link to={`/returns/apply?edit=${detail.id}`}>
                      <Button variant="secondary" size="sm">继续编辑</Button>
                    </Link>
                    <Button variant="secondary" size="sm" onClick={() => handleDelete(detail)}>删除</Button>
                  </>
                )}
                {detail.status === 'pending_arrival' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={actingId === detail.id}
                    onClick={() => void handleWithdraw(detail)}
                  >
                    {actingId === detail.id ? '撤回中…' : '撤回退件'}
                  </Button>
                )}
                {detail.status === 'cancelled' && (
                  <>
                    <Link to={`/returns/apply?edit=${detail.id}`}>
                      <Button size="sm">重新编辑并提交</Button>
                    </Link>
                    <Button variant="secondary" size="sm" onClick={() => handleDelete(detail)}>删除记录</Button>
                  </>
                )}
                {detail.status === 'awaiting_customer' && (
                  <div className="flex w-full flex-col gap-3">
                    <label className="text-xs text-text-secondary">
                      留货时的处理方式（费用在确认后收取）
                      <select
                        className="mt-1 w-full rounded border border-border px-2 py-1.5 text-sm"
                        value={decideProcess}
                        onChange={e => setDecideProcess(e.target.value)}
                      >
                        {RETURN_PROCESS_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </label>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setDetailId(null)}>
                        取消
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={actingId === detail.id}
                        onClick={() => void handleDecide(detail, 'discard')}
                      >
                        不留，销毁
                      </Button>
                      <Button
                        size="sm"
                        disabled={actingId === detail.id}
                        onClick={() => void handleDecide(detail, 'keep')}
                      >
                        留货并授权处理
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
