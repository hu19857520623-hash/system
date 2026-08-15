import { useState, useEffect, useMemo } from 'react'
import { CreditCard, Download, Copy, Check, Pencil, Save, X, ChevronDown, ChevronUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, PageHeader, Card, MonoCode, StatCard, Table, TableFooter, FilterChip, Badge } from '../components/ui'
import { formInput, formTextarea } from '../components/ui/form'
import { formatCurrency } from '../data/mockData'
import { useCustomerProfile } from '../data/entityStore'
import { rechargeViaErp, useBilling } from '../data/billingStore'
import { groupFeeRecordsByOutbound, isOutboundRefNo } from '../data/outboundFeeUtils'
import { useRole } from '../auth/RoleContext'
import { useDataScope } from '../auth/useDataScope'
import { getErpBills, type ErpBillItem } from '../api/erp'
import {
  usePaymentMethods,
  updatePaymentMethods,
} from '../data/paymentMethodStore'
import type { PaymentMethod } from '../data/feeTemplates'
import { DEFAULT_PAYMENT_METHODS } from '../data/feeTemplates'
import { getCustomerCode, getCustomerIdForRole } from '../data/dataScope'
import { exportFeeRecordsCsv } from '../data/listExport'

const feeTypeLabels: Record<string, string> = {
  storage: '仓储费', handling: '操作费', shipping: '物流费', recharge: '充值',
}

const feeTypeColors: Record<string, string> = {
  storage: 'text-indigo-600', handling: 'text-purple-600', shipping: 'text-sky-600', recharge: 'text-emerald-600',
}

function CopyableRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  if (!value.trim()) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }

  return (
    <div className="flex items-start justify-between gap-3 border-b border-border-light py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-[11px] text-text-muted">{label}</p>
        <p className="mt-0.5 break-all text-sm font-medium text-text-primary">{value}</p>
      </div>
      <button
        type="button"
        onClick={copy}
        className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-muted hover:text-text-primary"
        title="复制"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  )
}

function PaymentMethodsCard() {
  const allMethods = usePaymentMethods()
  const enabled = allMethods.filter(m => m.enabled).sort((a, b) => a.sortOrder - b.sortOrder)
  const { isAdmin } = useDataScope()
  const [activeId, setActiveId] = useState(enabled[0]?.id ?? '')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<PaymentMethod[]>(allMethods)
  const [editId, setEditId] = useState(activeId)
  const [saved, setSaved] = useState(false)

  const active = enabled.find(m => m.id === activeId) ?? enabled[0]
  const editingMethod = draft.find(m => m.id === editId) ?? draft[0]

  const startEdit = () => {
    setDraft(allMethods.map(m => ({ ...m })))
    setEditId(activeId || allMethods[0]?.id || '')
    setEditing(true)
    setSaved(false)
  }

  const cancelEdit = () => {
    setDraft(allMethods.map(m => ({ ...m })))
    setEditing(false)
  }

  const save = () => {
    updatePaymentMethods(draft)
    setEditing(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const resetDefault = () => {
    setDraft(DEFAULT_PAYMENT_METHODS.map(m => ({ ...m })))
  }

  const patchEditing = (patch: Partial<PaymentMethod>) => {
    setDraft(list => list.map(m => m.id === editId ? { ...m, ...patch } : m))
  }

  if (editing && editingMethod) {
    return (
      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-text-primary">编辑支付方式</p>
            <p className="mt-0.5 text-[11px] text-text-muted">对公转账、支付宝、微信收款信息均可自定义</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={resetDefault}>恢复默认</Button>
            <Button variant="secondary" size="sm" onClick={cancelEdit}>
              <X className="h-3.5 w-3.5" /> 取消
            </Button>
            <Button size="sm" onClick={save}>
              <Save className="h-3.5 w-3.5" /> 保存
            </Button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {draft.map(m => (
            <FilterChip key={m.id} active={editId === m.id} onClick={() => setEditId(m.id)}>
              {m.title}
            </FilterChip>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={editingMethod.enabled}
              onChange={e => patchEditing({ enabled: e.target.checked })}
              className="rounded border-border"
            />
            <span className="text-xs font-medium text-text-secondary">启用此支付方式</span>
          </label>
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-text-secondary">展示名称</span>
            <input className={formInput()} value={editingMethod.title} onChange={e => patchEditing({ title: e.target.value })} />
          </label>

          {editingMethod.type === 'bank_transfer' && (
            <>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-text-secondary">开户银行</span>
                <input className={formInput()} value={editingMethod.bankName ?? ''} onChange={e => patchEditing({ bankName: e.target.value })} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-text-secondary">账户名称</span>
                <input className={formInput()} value={editingMethod.accountName ?? ''} onChange={e => patchEditing({ accountName: e.target.value })} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-text-secondary">银行账号</span>
                <input className={formInput()} value={editingMethod.accountNumber ?? ''} onChange={e => patchEditing({ accountNumber: e.target.value })} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-text-secondary">开户支行</span>
                <input className={formInput()} value={editingMethod.branch ?? ''} onChange={e => patchEditing({ branch: e.target.value })} />
              </label>
              <label className="block space-y-1 sm:col-span-2">
                <span className="text-xs font-medium text-text-secondary">SWIFT / 联行号</span>
                <input className={formInput()} value={editingMethod.swiftCode ?? ''} onChange={e => patchEditing({ swiftCode: e.target.value })} />
              </label>
            </>
          )}

          {(editingMethod.type === 'alipay' || editingMethod.type === 'wechat') && (
            <>
              <label className="block space-y-1 sm:col-span-2">
                <span className="text-xs font-medium text-text-secondary">{editingMethod.type === 'alipay' ? '支付宝' : '微信'}账号</span>
                <input className={formInput()} value={editingMethod.accountId ?? ''} onChange={e => patchEditing({ accountId: e.target.value })} />
              </label>
              <label className="block space-y-1 sm:col-span-2">
                <span className="text-xs font-medium text-text-secondary">收款码图片 URL（可选）</span>
                <input className={formInput()} value={editingMethod.qrCodeUrl ?? ''} onChange={e => patchEditing({ qrCodeUrl: e.target.value })} placeholder="https://..." />
              </label>
            </>
          )}

          <label className="block space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-text-secondary">充值说明</span>
            <textarea className={formTextarea()} rows={4} value={editingMethod.customText} onChange={e => patchEditing({ customText: e.target.value })} />
          </label>
        </div>
      </Card>
    )
  }

  if (!active) {
    return (
      <Card className="p-6">
        <p className="text-sm text-text-muted">暂无可用支付方式，请联系管理员配置。</p>
      </Card>
    )
  }

  return (
    <Card className="p-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-primary">选择支付方式</p>
          <p className="mt-0.5 text-[11px] text-text-muted">请按所选方式完成充值 · 更新于 {active.updatedAt}</p>
        </div>
        {isAdmin && (
          <Button variant="secondary" size="sm" onClick={startEdit}>
            <Pencil className="h-3.5 w-3.5" /> {saved ? '已保存' : '编辑支付方式'}
          </Button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {enabled.map(m => (
          <FilterChip key={m.id} active={active.id === m.id} onClick={() => setActiveId(m.id)}>
            {m.title}
          </FilterChip>
        ))}
      </div>

      {active.type === 'bank_transfer' ? (
        <div className="rounded-xl bg-surface-muted/60 px-4 py-1 ring-1 ring-border-light">
          <CopyableRow label="开户银行" value={active.bankName ?? ''} />
          <CopyableRow label="账户名称" value={active.accountName ?? ''} />
          <CopyableRow label="银行账号" value={active.accountNumber ?? ''} />
          <CopyableRow label="开户支行" value={active.branch ?? ''} />
          <CopyableRow label="SWIFT / 联行号" value={active.swiftCode ?? ''} />
        </div>
      ) : (
        <div className="rounded-xl bg-surface-muted/60 px-4 py-4 ring-1 ring-border-light">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {active.qrCodeUrl ? (
              <img src={active.qrCodeUrl} alt={`${active.title}收款码`} className="h-36 w-36 rounded-lg border border-border bg-white object-contain p-2" />
            ) : (
              <div className="flex h-36 w-36 items-center justify-center rounded-lg border border-dashed border-border bg-white text-center text-[11px] text-text-muted">
                收款码待配置
              </div>
            )}
            <div className="min-w-0 flex-1">
              <CopyableRow label={`${active.title}账号`} value={active.accountId ?? ''} />
            </div>
          </div>
        </div>
      )}

      {active.customText.trim() && (
        <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-100">
          <p className="text-[11px] font-semibold text-amber-900">充值说明</p>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-amber-800">{active.customText}</p>
        </div>
      )}
    </Card>
  )
}

interface BillingPageProps {
  rechargeOnly?: boolean
}

export default function BillingPage({ rechargeOnly }: BillingPageProps) {
  const [feeTab, setFeeTab] = useState('all')
  const [rechargeAmount, setRechargeAmount] = useState(10000)
  const [recharging, setRecharging] = useState(false)
  const [rechargeMsg, setRechargeMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [erpBills, setErpBills] = useState<ErpBillItem[]>([])
  const { can, role } = useRole()
  const dataScope = useDataScope()
  const { creditBalance, feeRecords } = useBilling()
  const customer = useCustomerProfile()
  const budgetUsed = customer?.budgetUsed ?? 0
  const allMethods = usePaymentMethods()
  const enabledMethods = allMethods.filter(m => m.enabled).sort((a, b) => a.sortOrder - b.sortOrder)
  const [payMethodId, setPayMethodId] = useState(enabledMethods[0]?.id ?? 'bank')

  useEffect(() => {
    const customerId = getCustomerIdForRole(role)
    const customerCode = getCustomerCode(customerId ?? undefined, dataScope.customerOptions)
    if (!customerCode || customerCode === '—') {
      setErpBills([])
      return
    }
    void getErpBills(customerCode)
      .then(r => setErpBills(r.items || []))
      .catch(() => setErpBills([]))
  }, [role, dataScope.customerOptions])

  const monthlySpent = feeRecords
    .filter(f => f.type !== 'recharge' && f.amount < 0)
    .reduce((s, f) => s + Math.abs(f.amount), 0)

  const preDeductCount = feeRecords.filter(f => f.method === 'pre_deduct').length
  const outboundGroups = useMemo(() => groupFeeRecordsByOutbound(feeRecords), [feeRecords])
  const [expandedOutbound, setExpandedOutbound] = useState<string | null>(null)

  const filteredFees = feeRecords.filter(f => {
    if (rechargeOnly) return f.type === 'recharge'
    if (feeTab === 'outbound') return isOutboundRefNo(f.refNo)
    if (feeTab === 'all') return true
    return f.type === feeTab
  })

  const handleRecharge = async () => {
    const customerId = getCustomerIdForRole(role)
    const customerCode = getCustomerCode(customerId ?? undefined)
    if (!customerCode || customerCode === '—') {
      setRechargeMsg({ ok: false, text: '未绑定 ERP 客户编码，无法充值' })
      return
    }
    const method = enabledMethods.find(m => m.id === payMethodId) || enabledMethods[0]
    if (!window.confirm(`确认使用“${method?.title || '默认方式'}”充值 ${formatCurrency(rechargeAmount)}？`)) return
    setRecharging(true)
    setRechargeMsg(null)
    const result = await rechargeViaErp({
      customerCode,
      amount: rechargeAmount,
      paymentMethodId: method?.id || 'bank',
      paymentMethodTitle: method?.title,
    })
    setRecharging(false)
    if (result.ok) {
      setRechargeMsg({ ok: true, text: `充值成功，当前余额 ¥${result.balance.toFixed(2)}` })
    } else {
      setRechargeMsg({ ok: false, text: result.error })
    }
  }

  if (rechargeOnly) {
    return (
      <div className="page-shell">
        <PageHeader title="账户充值" desc="充值账户余额，用于出库预扣款与仓租自动扣费（即时到账至 ERP）" />

        <div className="mb-4">
          <PaymentMethodsCard />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card className="p-6">
            <p className="text-xs font-medium text-text-muted">当前余额</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-emerald-600">{formatCurrency(creditBalance)}</p>
            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">支付方式</label>
                <select
                  value={payMethodId}
                  onChange={e => setPayMethodId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                >
                  {enabledMethods.map(m => (
                    <option key={m.id} value={m.id}>{m.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">充值金额 (人民币)</label>
                <input
                  type="number"
                  value={rechargeAmount}
                  onChange={e => setRechargeAmount(Number(e.target.value))}
                  className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                />
              </div>
              {rechargeMsg && (
                <p className={`text-xs ${rechargeMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                  {rechargeMsg.text}
                </p>
              )}
              <div className="flex gap-2">
                <Link to="/billing" className="flex-1">
                  <Button variant="secondary" className="w-full">取消</Button>
                </Link>
                <Button className="flex-1" disabled={recharging} onClick={() => void handleRecharge()}>
                  <CreditCard className="h-4 w-4" /> {recharging ? '提交中…' : '确认充值'}
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <p className="mb-4 text-sm font-semibold text-text-primary">充值记录</p>
            <ul className="divide-y divide-border-light">
              {feeRecords.filter(f => f.type === 'recharge').map(f => (
                <li key={f.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                      <span>客户代码 <span className="font-medium text-text-secondary">{f.customerCode || '—'}</span></span>
                      <span>时间 <span className="font-medium text-text-secondary">{f.date}</span></span>
                      {f.paymentMethodTitle && (
                        <span>方式 <span className="font-medium text-text-secondary">{f.paymentMethodTitle}</span></span>
                      )}
                    </div>
                    <p className="text-xs text-text-muted">
                      充值编号{' '}
                      <MonoCode>{f.rechargeNo || f.refNo || '—'}</MonoCode>
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-emerald-600">+{formatCurrency(f.amount)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="费用账单"
        desc="出库提交时预扣试算费用；ERP 发运后按实测实算对账，差额自动补扣或退还"
        action={
          <>
            <Button variant="secondary" size="sm" onClick={() => exportFeeRecordsCsv(filteredFees)}>
              <Download className="h-3.5 w-3.5" /> 下载账单
            </Button>
            {can('billing:recharge') && (
              <Link to="/billing/recharge"><Button size="sm"><CreditCard className="h-3.5 w-3.5" /> 充值</Button></Link>
            )}
          </>
        }
      />

      <div className="mb-4 rounded-xl bg-primary-50 px-4 py-3 ring-1 ring-primary-100">
        <p className="text-xs font-semibold text-primary-900">预扣 + 实算对账</p>
        <p className="mt-1 text-[11px] leading-relaxed text-primary-800">
          出库提交时按模板<strong>预扣</strong>操作/物流费；ERP 发运后按实测<strong>实算</strong>入账，
          系统自动比对预扣与实扣差额（补扣或退还）。换标等附加费单独计入实扣。
        </p>
      </div>

      <div className="mb-4 grid grid-cols-4 gap-4">
        <StatCard label="账户余额" value={formatCurrency(creditBalance)} />
        <StatCard label="累计扣费" value={formatCurrency(monthlySpent)} sub="含预扣与实际结算" />
        <StatCard label="预扣笔数" value={preDeductCount} sub="出库提交时产生" />
        <Card padding>
          <p className="text-xs font-medium text-text-muted">预算使用</p>
          <p className="mt-2 text-2xl font-bold tracking-tight">{budgetUsed}%</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-subtle">
            <div className="h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-600" style={{ width: `${budgetUsed}%` }} />
          </div>
        </Card>
      </div>

      <Card className="mb-4 p-5">
        <p className="mb-4 text-sm font-semibold text-text-primary">2026年7月（进行中）</p>
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: '仓储费', value: feeRecords.filter(f => f.type === 'storage').reduce((s, f) => s + Math.abs(f.amount), 0), color: 'bg-indigo-50 text-indigo-700 ring-indigo-100' },
            { label: '操作费', value: feeRecords.filter(f => f.type === 'handling').reduce((s, f) => s + Math.abs(f.amount), 0), color: 'bg-purple-50 text-purple-700 ring-purple-100' },
            { label: '物流费', value: feeRecords.filter(f => f.type === 'shipping').reduce((s, f) => s + Math.abs(f.amount), 0), color: 'bg-sky-50 text-sky-700 ring-sky-100' },
            { label: '换标费', value: feeRecords.filter(f => f.type === 'relabel').reduce((s, f) => s + Math.abs(f.amount), 0), color: 'bg-amber-50 text-amber-700 ring-amber-100' },
          ].map(f => (
            <div key={f.label} className={`rounded-xl px-4 py-4 ring-1 ${f.color}`}>
              <p className="text-xs opacity-80">{f.label}</p>
              <p className="mt-1 text-xl font-bold">{formatCurrency(f.value)}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-secondary">合计 <span className="font-bold text-text-primary">{formatCurrency(monthlySpent)}</span></p>
          <Button variant="secondary" size="sm" onClick={() => exportFeeRecordsCsv(feeRecords.filter(f => f.type !== 'recharge' && f.amount < 0))}>
            <Download className="h-3.5 w-3.5" /> 导出扣费明细
          </Button>
        </div>
      </Card>

      {erpBills.length > 0 && (
        <Card className="mb-4 overflow-hidden">
          <div className="border-b border-border-light px-5 py-3">
            <p className="text-sm font-semibold text-text-primary">ERP 月度账单</p>
            <p className="mt-0.5 text-[11px] text-text-muted">海外仓确认入账后生成的正式账单（与上方预扣流水区分）</p>
          </div>
          <Table>
            <thead className="table-head">
              <tr>
                <th>账单号</th>
                <th>账期</th>
                <th>状态</th>
                <th className="text-right">金额</th>
                <th className="text-right">已付</th>
              </tr>
            </thead>
            <tbody className="table-body">
              {erpBills.map(b => (
                <tr key={b.id} className="table-row">
                  <td className="table-cell"><MonoCode>{b.billingNo}</MonoCode></td>
                  <td className="table-cell text-xs">{b.billingMonth}</td>
                  <td className="table-cell">
                    <Badge
                      status={b.status === 'confirmed' ? 'available' : b.status === 'pending' ? 'reviewing' : 'shipped'}
                      label={b.status === 'confirmed' ? '已确认' : b.status === 'pending' ? '待确认' : b.status}
                    />
                  </td>
                  <td className="table-cell text-right text-sm font-semibold">{formatCurrency(b.totalAmount)}</td>
                  <td className="table-cell text-right text-xs text-text-muted">{formatCurrency(b.paidAmount)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {['all', 'outbound', 'storage', 'handling', 'shipping', 'recharge'].map(t => (
          <FilterChip key={t} active={feeTab === t} onClick={() => setFeeTab(t)}>
            {t === 'all' ? '全部' : t === 'outbound' ? '出库对账' : feeTypeLabels[t]}
          </FilterChip>
        ))}
      </div>

      {feeTab === 'outbound' && outboundGroups.length > 0 && (
        <Card className="mb-4 overflow-hidden">
          <div className="border-b border-border-light px-5 py-3">
            <p className="text-sm font-semibold text-text-primary">按出库单聚合</p>
            <p className="mt-0.5 text-[11px] text-text-muted">同一出库单的预扣、实扣、对账流水归为一组</p>
          </div>
          <div className="divide-y divide-border-light">
            {outboundGroups.map(g => {
              const expanded = expandedOutbound === g.outboundNo
              return (
                <div key={g.outboundNo}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-surface-muted/30"
                    onClick={() => setExpandedOutbound(expanded ? null : g.outboundNo)}
                  >
                    {expanded ? <ChevronUp className="h-4 w-4 shrink-0 text-text-muted" /> : <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary"><MonoCode>{g.outboundNo}</MonoCode></p>
                      <p className="mt-0.5 text-[11px] text-text-muted">
                        预扣 {formatCurrency(g.preDeductTotal)}
                        {g.actualTotal > 0 && <> · 实扣 {formatCurrency(g.actualTotal)}</>}
                        {g.settlementAdjust !== 0 && (
                          <span className={g.settlementAdjust > 0 ? ' text-emerald-600' : ' text-orange-600'}>
                            {' '}· 对账 {g.settlementAdjust > 0 ? '+' : ''}{formatCurrency(g.settlementAdjust)}
                          </span>
                        )}
                      </p>
                    </div>
                    <Badge
                      status={g.settled ? 'available' : g.preDeductTotal > 0 ? 'reviewing' : 'locked'}
                      label={g.settled ? '已对账' : g.preDeductTotal > 0 ? '待对账' : '—'}
                    />
                    <Link
                      to={`/outbound/records?orderNo=${encodeURIComponent(g.outboundNo)}&orderNoMode=exact`}
                      className="shrink-0 text-[11px] text-primary-600 hover:underline"
                      onClick={e => e.stopPropagation()}
                    >
                      查看出库
                    </Link>
                  </button>
                  {expanded && (
                    <div className="bg-surface-muted/20 px-5 pb-3">
                      <Table>
                        <thead className="table-head">
                          <tr>
                            <th>日期</th>
                            <th>阶段</th>
                            <th>说明</th>
                            <th className="text-right">金额</th>
                          </tr>
                        </thead>
                        <tbody className="table-body">
                          {g.records.map(f => (
                            <tr key={f.id} className="table-row">
                              <td className="table-cell text-xs text-text-muted">{f.date}</td>
                              <td className="table-cell text-xs">
                                {f.method === 'pre_deduct' && <span className="text-amber-700">预扣</span>}
                                {f.method === 'actual' && <span className="text-sky-700">实扣</span>}
                                {f.method === 'settlement_adjust' && <span className="text-violet-700">对账</span>}
                                {!f.method && '—'}
                              </td>
                              <td className="table-cell text-xs text-text-secondary">{f.desc}</td>
                              <td className={`table-cell text-right text-xs font-semibold ${f.amount > 0 ? 'text-emerald-600' : ''}`}>
                                {f.amount > 0 ? '+' : '-'}{formatCurrency(Math.abs(f.amount))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <Table>
          <thead className="table-head">
            <tr>
              <th>日期</th>
              <th>类型</th>
              <th>关联单号</th>
              <th>说明</th>
              <th className="text-right">金额</th>
            </tr>
          </thead>
          <tbody className="table-body">
            {filteredFees.map(f => (
              <tr key={f.id} className="table-row">
                <td className="table-cell text-xs text-text-muted">{f.date}</td>
                <td className={`table-cell text-xs font-semibold ${feeTypeColors[f.type]}`}>
                  {feeTypeLabels[f.type]}
                  {f.method === 'pre_deduct' && (
                    <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-800">预扣</span>
                  )}
                  {f.method === 'settlement_adjust' && (
                    <span className="ml-1 rounded bg-violet-100 px-1 py-0.5 text-[9px] font-medium text-violet-800">对账</span>
                  )}
                  {f.method === 'actual' && (
                    <span className="ml-1 rounded bg-sky-100 px-1 py-0.5 text-[9px] font-medium text-sky-800">实扣</span>
                  )}
                </td>
                <td className="table-cell">{f.refNo !== '—' ? <MonoCode>{f.refNo}</MonoCode> : <span className="text-xs text-text-muted">—</span>}</td>
                <td className="table-cell text-xs text-text-secondary">{f.desc}</td>
                <td className={`table-cell text-right text-xs font-bold ${f.amount > 0 ? 'text-emerald-600' : 'text-text-primary'}`}>
                  {f.amount > 0 ? '+' : '-'}{formatCurrency(Math.abs(f.amount))}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <TableFooter total={filteredFees.length} />
      </Card>
    </div>
  )
}
