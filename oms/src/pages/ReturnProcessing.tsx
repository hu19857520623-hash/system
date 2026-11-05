
import { userFacingError } from '../utils/userFacingError'
import { displaySku, displaySkuText } from '../data/skuDisplay'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { authSessionScope } from '../api/client'
import { createAsyncViewScope } from '../utils/asyncViewScope'
import { Link, useSearchParams } from 'react-router-dom'
import { RefreshCw, Plus } from 'lucide-react'
import { Badge, Button, Card, MonoCode, PageHeader, Table, TableFooter } from '../components/ui'
import { DropdownBtn } from '../components/ui/filters'
import { useReturnOrders, addReturnOrdersOrThrow } from '../data/entityStore'
import { buildImportedReturnDrafts } from '../data/returnDraftImport'
import { returnInspectionLabel, returnProcessLabel, returnStatusLabel } from '../data/returnDisplay'
import {
  RETURN_STATUS_LABELS,
  RETURN_PROCESS_OPTIONS,
  refreshReturnsFromErp,
  removeReturnOrder,
  withdrawReturnOrder,
  replayReturnDecision,
} from '../data/returnStore'
import { formatDatetimeDisplay } from '../data/fileUtils'
import { importCsvFile } from '../data/csvImportExport'
import { reportLineImportResult } from '../utils/lineImportResult'
import {
  RETURN_ORDER_COLUMNS,
  downloadReturnOrderTemplate,
  parseReturnOrders,
} from '../data/importTemplates'
import { useRole } from '../auth/RoleContext'
import { useDataScope } from '../auth/useDataScope'
import { getCustomerCode, getCustomerIdForRole, resolveErpCustomerContext } from '../data/dataScope'
import { AdminCustomerFilter } from '../components/admin/AdminCustomerFilter'
import { notifyIfUserError, notifySuccess, notifyInfo, notifyError } from '../utils/userNotify'

type Tab = 'all' | 'draft' | 'pending_arrival' | 'awaiting_customer' | 'arrived' | 'completed' | 'cancelled'
type DecisionIntent = Parameters<typeof replayReturnDecision>[0]

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
  const { role, can, userId, authToken, permissions, authReady } = useRole()
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
  const decisionCustomerId = erpCustomer?.customerId
  const decisionCustomerCode = erpCustomer?.customerCode
  const decisionKey = authReady && authToken && userId && decisionCustomerId && decisionCustomerCode && can('returns:write')
    ? `oms.return.decision.${JSON.stringify([userId, decisionCustomerId, decisionCustomerCode])}` : ''
  const decisionScope = JSON.stringify([decisionKey, authToken, role, [...permissions].sort()])
  const decisionView = useRef(createAsyncViewScope()).current
  const [decisionState, setDecisionState] = useState<{ scope: string; intent?: DecisionIntent; error?: string }>()
  const [decisionRun, setDecisionRun] = useState<{ scope: string }>()
  const decisionBusy = decisionRun?.scope === decisionScope
  const pendingDecision = decisionState?.scope === decisionScope ? decisionState.intent : undefined
  const decisionError = decisionState?.scope === decisionScope ? decisionState.error : undefined

  useLayoutEffect(() => {
    decisionView.update(decisionScope)
    const read = () => {
      try {
        const raw = decisionKey && localStorage.getItem(decisionKey)
        if (!raw) { setDecisionState(undefined); return }
        const intent: DecisionIntent = JSON.parse(raw)
        if (!intent.returnNo || intent.customerId !== decisionCustomerId || intent.customerCode !== decisionCustomerCode ||
          !['keep', 'discard'].includes(intent.decision) || (intent.decision === 'keep' && !intent.processChoice)) throw Error()
        setDecisionState({ scope: decisionScope, intent })
      } catch { setDecisionState({ scope: decisionScope, error: '原退件决定无法读取，请保留记录并核对浏览器存储' }) }
    }
    read()
    const changed = (event: StorageEvent) => { if (event.key === decisionKey || event.key === null) read() }
    window.addEventListener('storage', changed)
    return () => { decisionView.dispose(); window.removeEventListener('storage', changed) }
  }, [decisionView, decisionScope, decisionKey, decisionCustomerId, decisionCustomerCode])

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
    if (syncing) return
    const customerId = dataScope.bindingCustomerId
    if (!customerId) {
      notifyInfo('请先选择要同步退件的客户')
      return
    }
    setSyncing(true)
    try {
      const n = await refreshReturnsFromErp(customerId)
      notifySuccess(`已从 ERP 同步 ${n} 条退件状态`)
    } catch (err) {
      notifyError(userFacingError(displaySkuText(err instanceof Error ? err.message : String(err))))
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
        window.alert(userFacingError(displaySkuText(result.error)))
        return
      }
      if (result.warning) notifyInfo(result.warning)
      else notifySuccess('已撤回；可在「已撤回」标签页查看该退件单')
      if (detailId === r.id) setDetailId(null)
    } finally {
      setActingId(null)
    }
  }

  const handleDelete = async (r: typeof returns[0]) => {
    if (actingId) return
    if (!window.confirm(`确认删除退件单 ${r.returnNo}？此操作不可恢复。`)) return
    setActingId(r.id)
    const result = await removeReturnOrder(r)
    setActingId(null)
    if (!result.ok) {
      notifyError(userFacingError(displaySkuText(result.error)))
      return
    }
    if (detailId === r.id) setDetailId(null)
    notifySuccess('退件记录已删除')
  }

  const canWrite = can('returns:write')

  const handleBulkImport = async () => {
    if (!canWrite) return
    try {
      const result = await importCsvFile(RETURN_ORDER_COLUMNS, parseReturnOrders)
      const customerId = erpCustomer?.customerId ?? getCustomerIdForRole(role) ?? undefined
      if (dataScope.isAdmin && !customerId && result.data.length > 0) {
        window.alert('请先在上方选择要代操作的客户端，再批量导入退件')
        return
      }

      await reportLineImportResult(
        result,
        async () => {
          const orders = buildImportedReturnDrafts(result.data, { customerId: customerId || '',
            customerCode: erpCustomer?.customerCode || getCustomerCode(customerId), existingNos: allReturns.map(order => order.returnNo) })
          await addReturnOrdersOrThrow(orders)
          setTab('draft')
        },
        {
          successMessage: n => `已导入 ${n} 张退件预约单（草稿），请在列表中核对后提交`,
          emptyMessage: '未解析到有效退件单，请使用最新模板',
        },
      )
    } catch (err) {
      notifyIfUserError(err, '导入失败')
    }
  }

  const sendDecision = async (newIntent?: DecisionIntent) => {
    if (!decisionKey || decisionBusy || decisionError) return
    const viewCurrent = decisionView.capture(), session = authSessionScope()
    const current = () => viewCurrent() && authSessionScope() === session
    const run = { scope: decisionScope }
    setDecisionRun(run)
    try {
      if (!navigator.locks?.request) throw Error('当前浏览器无法协调退件确认，请使用支持标签页锁的浏览器')
      await navigator.locks.request(decisionKey, async () => {
        if (!current()) return
        let raw = localStorage.getItem(decisionKey)
        if (newIntent && raw) { notifyInfo('已有原退件决定待核对，请继续原决定'); return }
        const intent = newIntent || pendingDecision
        if (!intent) return
        if (newIntent) {
          raw = JSON.stringify(intent)
          localStorage.setItem(decisionKey, raw)
        }
        if (!raw || localStorage.getItem(decisionKey) !== JSON.stringify(intent)) throw Error('原退件决定保存或核对失败，请刷新页面核对')
        setDecisionState({ scope: decisionScope, intent })
        const result = await replayReturnDecision(intent, current)
        if (!current()) return
        if (!result.ok && !('conflict' in result)) { notifyError(userFacingError(displaySkuText(result.error))); return }
        if (localStorage.getItem(decisionKey) !== raw) return
        localStorage.removeItem(decisionKey)
        if (localStorage.getItem(decisionKey) !== null) throw Error('原退件决定记录未能清理，请继续核对')
        setDecisionState(undefined)
        if (!result.ok) { notifyError(userFacingError(displaySkuText(result.error))); await handleSync(); return }
        if (result.warning) notifyInfo(result.warning)
        else notifySuccess('原退件决定已确认，请核对当前状态')
        setDetailId(null)
      })
    } catch (error) { if (current()) notifyError(userFacingError(error)) }
    finally { setDecisionRun(active => active === run ? undefined : active) }
  }

  const handleDecide = async (r: typeof returns[0], decision: 'keep' | 'discard') => {
    if (!decisionKey || r.customerId !== decisionCustomerId || !decisionCustomerCode) {
      notifyError('请先核对退件所属客户与当前账号权限'); return
    }
    const msg = decision === 'discard'
      ? `确认不留货并销毁退件单 ${r.returnNo}？将产生销毁相关费用。`
      : `确认留货并授权处理退件单 ${r.returnNo}？将按所选方式追加费用。`
    if (!window.confirm(msg)) return
    await sendDecision({ returnNo: r.returnNo, customerId: decisionCustomerId, customerCode: decisionCustomerCode,
      decision, ...(decision === 'keep' ? { processChoice: decideProcess } : {}) })
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

      {(pendingDecision || decisionError) && <Card className="mb-4 p-4">
        <p role="status">{decisionError || `退件单 ${pendingDecision?.returnNo} 的原决定待核对`}</p>
        {pendingDecision && <Button size="sm" disabled={decisionBusy} onClick={() => void sendDecision()}>继续原决定</Button>}
        <Button size="sm" variant="secondary" disabled={syncing || decisionBusy} onClick={() => void handleSync()}>同步并核对状态</Button>
      </Card>}

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
              <th className="table-ops">操作</th>
            </tr>
          </thead>
          <tbody className="table-body">
            {returns.map(r => {
              const skuLabel = r.lineItems.length === 1
                ? displaySku(r.lineItems[0].sku, r.customerId)
                : r.lineItems.length ? `${displaySku(r.lineItems[0]?.sku, r.customerId)} 等 ${r.lineItems.length} SKU` : '—'
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
                  <td className="table-cell text-xs"><MonoCode>{displaySkuText(skuLabel)}</MonoCode></td>
                  <td className="table-cell text-xs">{r.totalQty ?? r.lineItems.reduce((s, i) => s + i.qty, 0)}</td>
                  <td className="table-cell text-xs text-text-secondary">{r.returnReason}</td>
                  <td className="table-cell text-xs">{returnProcessLabel(r.requestedProcess, r.requestedProcessLabel)}</td>
                  <td className="table-cell text-xs">
                    {formatReturnFee(r.estimatedFeeTotal)}
                  </td>
                  <td className="table-cell">
                    <Badge status={r.status} label={returnStatusLabel(r.status, r.statusLabel, RETURN_STATUS_LABELS)} />
                  </td>
                  <td className="table-cell text-xs">
                    {r.status === 'completed'
                      ? returnProcessLabel(r.processResult, r.processResultLabel)
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
                ['期望处理', returnProcessLabel(detail.requestedProcess, detail.requestedProcessLabel)],
                ['当前状态', returnStatusLabel(detail.status, detail.statusLabel, RETURN_STATUS_LABELS)],
                ['体积 CBM', detail.totalVolumeCbm != null ? String(detail.totalVolumeCbm) : '—'],
                ['预估费用', formatReturnFee(detail.estimatedFeeTotal)],
                ['质检结论', returnInspectionLabel(detail.inspectionResult, detail.inspectionResultLabel)],
                ['收货时间', detail.receivedAt || '—'],
                ['处理结果', returnProcessLabel(detail.processResult, detail.processResultLabel)],
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
                    <span><MonoCode>{displaySku(l.sku, detail.customerId)}</MonoCode> · {l.name}</span>
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
                        disabled={decisionBusy || !!pendingDecision || !!decisionError}
                        onClick={() => void handleDecide(detail, 'discard')}
                      >
                        不留，销毁
                      </Button>
                      <Button
                        size="sm"
                        disabled={decisionBusy || !!pendingDecision || !!decisionError}
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
