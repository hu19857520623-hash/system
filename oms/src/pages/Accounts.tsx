import { useState } from 'react'
import { Ban, Check, KeyRound, Pencil, Plus, Receipt } from 'lucide-react'
import {
  Button, Card, PageHeader, Badge, Table, TableFooter, MonoCode,
} from '../components/ui'
import {
  PERMISSION_GROUPS, ACCOUNT_TYPE_LABELS, permissionsForAccountType,
  type Permission, type CustomerAccountType,
} from '../auth/permissions'
import { useRole } from '../auth/RoleContext'
import { useFeeTemplates, getPriceTemplatesForRegion } from '../data/feeTemplateStore'
import { formInput, formSelect, FormField } from '../components/ui/form'
import {
  resolveCustomerPriceTemplateBindings,
  regionLabel,
  enabledDispatchRules,
  DEFAULT_SHIPPING_REGION_CODES,
} from '../data/feeTemplates'
import type { CustomerAccount } from '../data/mockData'
import { apiPost } from '../api/client'
import { bootstrapFromApi } from '../data/DataBootstrap'

type CreateAccountDraft = {
  customerCode: string
  customerName: string
  companyName: string
  contactName: string
  contactPhone: string
  email: string
  username: string
  omsType: CustomerAccountType
  warehouse: string
  permissionTemplate: CustomerAccountType
  temporaryPassword: string
  confirmPassword: string
}

type ResetPasswordDraft = {
  temporaryPassword: string
  confirmPassword: string
}

type Feedback = {
  kind: 'success' | 'error'
  message: string
}

const EMPTY_CREATE_DRAFT: CreateAccountDraft = {
  customerCode: '',
  customerName: '',
  companyName: '',
  contactName: '',
  contactPhone: '',
  email: '',
  username: '',
  omsType: 'ecommerce',
  warehouse: 'WMS-JHB-01',
  permissionTemplate: 'ecommerce',
  temporaryPassword: '',
  confirmPassword: '',
}

const EMPTY_RESET_DRAFT: ResetPasswordDraft = {
  temporaryPassword: '',
  confirmPassword: '',
}

function isPortalUsername(value: string) {
  return /^[A-Za-z0-9._-]{6,50}$/.test(value.trim())
}

function isStrongTemporaryPassword(value: string) {
  return value.length >= 6 && value.length <= 128
}

function templateName(priceTemplates: { id: string; name: string }[], id: string | null | undefined) {
  if (!id) return '默认'
  return priceTemplates.find(t => t.id === id)?.name ?? '默认'
}

export default function Accounts() {
  const { accounts, updateAccount, toggleAccountStatus, can, authToken } = useRole()
  const { priceTemplates, regionDispatchRules } = useFeeTemplates()
  const dispatchRules = enabledDispatchRules(regionDispatchRules)
  const [editing, setEditing] = useState<CustomerAccount | null>(null)
  const [draftPerms, setDraftPerms] = useState<Permission[]>([])
  const [priceBinding, setPriceBinding] = useState<CustomerAccount | null>(null)
  const [draftPriceByRegion, setDraftPriceByRegion] = useState<Record<string, string | null>>({})
  const [creating, setCreating] = useState(false)
  const [createDraft, setCreateDraft] = useState<CreateAccountDraft>(EMPTY_CREATE_DRAFT)
  const [createError, setCreateError] = useState('')
  const [createSaving, setCreateSaving] = useState(false)
  const [resetting, setResetting] = useState<CustomerAccount | null>(null)
  const [resetDraft, setResetDraft] = useState<ResetPasswordDraft>(EMPTY_RESET_DRAFT)
  const [resetError, setResetError] = useState('')
  const [resetSaving, setResetSaving] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const openEdit = (acc: CustomerAccount) => {
    setEditing(acc)
    setDraftPerms([...acc.permissions])
  }

  const togglePerm = (p: Permission) => {
    setDraftPerms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])
  }

  const applyTypeTemplate = (type: CustomerAccountType) => {
    if (!editing) return
    setDraftPerms(permissionsForAccountType(type))
  }

  const savePerms = () => {
    if (!editing) return
    updateAccount(editing.id, { permissions: draftPerms })
    setEditing(null)
  }

  const openPriceBinding = (acc: CustomerAccount) => {
    setPriceBinding(acc)
    setDraftPriceByRegion(resolveCustomerPriceTemplateBindings(
      acc.priceTemplateByRegion,
      acc.priceTemplateId,
    ))
  }

  const savePriceBinding = () => {
    if (!priceBinding) return
    updateAccount(priceBinding.id, {
      priceTemplateByRegion: { ...draftPriceByRegion },
      priceTemplateId: null,
    })
    setPriceBinding(null)
  }

  const activeCount = accounts.filter(a => a.status === 'active').length
  const disabledCount = accounts.filter(a => a.status === 'disabled').length

  const refreshAccountList = async () => {
    await bootstrapFromApi(authToken, true)
  }

  const createAccount = async () => {
    setCreateError('')
    setFeedback(null)
    const required: [keyof CreateAccountDraft, string][] = [
      ['customerName', '客户名称'],
      ['warehouse', '仓库'],
      ['email', '联系邮箱'],
      ['username', '登录账号'],
      ['temporaryPassword', '临时密码'],
    ]
    const missing = required.find(([key]) => !createDraft[key].trim())
    if (missing) return setCreateError(`请填写${missing[1]}`)
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (
      createDraft.customerCode.trim()
      && (
        !/^[A-Za-z0-9_-]+$/.test(createDraft.customerCode.trim())
        || createDraft.customerCode.trim().length > 30
      )
    ) {
      return setCreateError('客户代码最多 30 位，且只能包含字母、数字、下划线和短横线')
    }
    if (createDraft.customerName.trim().length > 200) return setCreateError('客户名称最多 200 个字符')
    if (createDraft.companyName.trim().length > 200) return setCreateError('公司名称最多 200 个字符')
    if (createDraft.contactName.trim().length > 50) return setCreateError('联系人最多 50 个字符')
    if (createDraft.contactPhone.trim().length > 30) return setCreateError('联系电话最多 30 个字符')
    if (createDraft.warehouse.trim().length > 100) return setCreateError('仓库编码最多 100 个字符')
    if (!emailPattern.test(createDraft.email.trim())) return setCreateError('联系邮箱格式无效')
    if (createDraft.email.trim().length > 120) return setCreateError('联系邮箱最多 120 个字符')
    if (!isPortalUsername(createDraft.username)) {
      return setCreateError('登录账号须为 6-50 位字母、数字、点、下划线或短横线')
    }
    if (!isStrongTemporaryPassword(createDraft.temporaryPassword)) {
      return setCreateError('临时密码须为 6-128 位')
    }
    if (createDraft.temporaryPassword !== createDraft.confirmPassword) {
      return setCreateError('两次输入的临时密码不一致')
    }
    setCreateSaving(true)
    try {
      const email = createDraft.email.trim().toLowerCase()
      const username = createDraft.username.trim().toLowerCase()
      const response = await apiPost<unknown>('/accounts', {
        ...(createDraft.customerCode.trim()
          ? { customerCode: createDraft.customerCode.trim() }
          : {}),
        customerName: createDraft.customerName.trim(),
        companyName: createDraft.companyName.trim() || undefined,
        contactName: createDraft.contactName.trim() || undefined,
        contactPhone: createDraft.contactPhone.trim() || undefined,
        email,
        contactEmail: email,
        username,
        omsType: createDraft.omsType,
        warehouse: createDraft.warehouse.trim(),
        permissionTemplate: createDraft.permissionTemplate,
        temporaryPassword: createDraft.temporaryPassword,
      })
      const responseRecord = response && typeof response === 'object'
        ? response as Record<string, unknown>
        : null
      const customer = responseRecord?.customer
      const customerRecord = customer && typeof customer === 'object'
        ? customer as Record<string, unknown>
        : null
      const createdCode = String(customerRecord?.code || customerRecord?.customerCode || '').trim()
      setCreateDraft(EMPTY_CREATE_DRAFT)
      setCreating(false)
      try {
        await refreshAccountList()
        setFeedback({
          kind: 'success',
          message: `客户账号${createdCode ? ` ${createdCode}` : ''}已创建，首次登录时必须修改临时密码。`,
        })
      } catch (refreshError) {
        setFeedback({
          kind: 'error',
          message: `客户账号已创建，但列表刷新失败：${refreshError instanceof Error ? refreshError.message : String(refreshError)}`,
        })
      }
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : '创建账号失败')
    } finally {
      setCreateSaving(false)
    }
  }

  const openPasswordReset = (account: CustomerAccount) => {
    setResetting(account)
    setResetDraft(EMPTY_RESET_DRAFT)
    setResetError('')
    setFeedback(null)
  }

  const resetTemporaryPassword = async () => {
    if (!resetting) return
    setResetError('')
    if (!isStrongTemporaryPassword(resetDraft.temporaryPassword)) {
      return setResetError('临时密码须为 6-128 位')
    }
    if (resetDraft.temporaryPassword !== resetDraft.confirmPassword) {
      return setResetError('两次输入的临时密码不一致')
    }

    setResetSaving(true)
    try {
      await apiPost<unknown>(
        `/accounts/${resetting.id}/reset-password`,
        { temporaryPassword: resetDraft.temporaryPassword },
      )
      const accountCode = resetting.code
      setResetDraft(EMPTY_RESET_DRAFT)
      setResetting(null)
      try {
        await refreshAccountList()
        setFeedback({
          kind: 'success',
          message: `${accountCode} 的临时密码已重置，客户下次登录必须修改密码。`,
        })
      } catch (refreshError) {
        setFeedback({
          kind: 'error',
          message: `临时密码已重置，但列表刷新失败：${refreshError instanceof Error ? refreshError.message : String(refreshError)}`,
        })
      }
    } catch (error) {
      setResetError(error instanceof Error ? error.message : '重置失败')
    } finally {
      setResetSaving(false)
    }
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="账号管理"
        desc="系统管理员统一维护客户账号（电商 / 货盘 / 混合），分配模块权限，可禁用违规或欠费账号"
        action={(
          <Button onClick={() => { setCreating(true); setCreateError(''); setFeedback(null) }}>
            <Plus className="h-4 w-4" /> 新建客户账号
          </Button>
        )}
      />

      {feedback && (
        <div
          className={`mb-4 rounded-lg px-4 py-3 text-sm ring-1 ${
            feedback.kind === 'success'
              ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
              : 'bg-red-50 text-red-700 ring-red-100'
          }`}
          role="status"
        >
          {feedback.message}
        </div>
      )}

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Card padding className="text-center">
          <p className="text-2xl font-bold text-text-primary">{accounts.length}</p>
          <p className="text-xs text-text-muted">客户账号总数</p>
        </Card>
        <Card padding className="text-center">
          <p className="text-2xl font-bold text-emerald-600">{activeCount}</p>
          <p className="text-xs text-text-muted">启用中</p>
        </Card>
        <Card padding className="text-center">
          <p className="text-2xl font-bold text-red-500">{disabledCount}</p>
          <p className="text-xs text-text-muted">已禁用</p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <thead className="table-head">
            <tr>
              <th>客户代码</th>
              <th>类型</th>
              <th>联系人</th>
              <th>邮箱</th>
              <th>权限数</th>
              <th>价格模板（按地区）</th>
              <th>状态</th>
              <th>登录准备状态</th>
              <th>最近登录</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody className="table-body">
            {accounts.map(acc => (
              <tr key={acc.id} className={`table-row ${acc.status === 'disabled' ? 'opacity-60' : ''}`}>
                <td className="table-cell">
                  <MonoCode>{acc.code}</MonoCode>
                  <p className="mt-0.5 text-[11px] text-text-muted">{acc.contact}</p>
                </td>
                <td className="table-cell">
                  <Badge
                    status={acc.type === 'ecommerce' ? 'connected' : acc.type === 'hybrid' ? 'shipped' : 'reviewing'}
                    label={ACCOUNT_TYPE_LABELS[acc.type]}
                  />
                </td>
                <td className="table-cell text-xs">{acc.contact}</td>
                <td className="table-cell text-xs text-text-secondary">{acc.email}</td>
                <td className="table-cell text-xs">{acc.permissions.length} 项</td>
                <td className="table-cell">
                  {(() => {
                    const bindings = resolveCustomerPriceTemplateBindings(
                      acc.priceTemplateByRegion,
                      acc.priceTemplateId,
                    )
                    return (
                      <div className="space-y-1">
                        {DEFAULT_SHIPPING_REGION_CODES.map(code => (
                          <p key={code} className="text-[11px] text-text-secondary">
                            <span className="font-medium text-text-primary">{code.toUpperCase()}</span>
                            {' · '}
                            {templateName(priceTemplates, bindings[code])}
                          </p>
                        ))}
                        {can('account:assign') && (
                          <Button variant="ghost" size="sm" className="mt-1 h-7 px-2" onClick={() => openPriceBinding(acc)}>
                            <Receipt className="h-3 w-3" /> 绑定
                          </Button>
                        )}
                      </div>
                    )
                  })()}
                </td>
                <td className="table-cell">
                  <Badge
                    status={acc.status === 'active' ? 'available' : 'discarded'}
                    label={acc.status === 'active' ? '启用' : '已禁用'}
                  />
                </td>
                <td className="table-cell">
                  {!acc.portalUser ? (
                    <Badge status="discarded" label="未开通登录" />
                  ) : acc.portalUser.status !== 'active' ? (
                    <Badge status="discarded" label="登录已停用" />
                  ) : acc.portalUser.mustChangePassword ? (
                    <Badge status="reviewing" label="待首次改密" />
                  ) : (
                    <Badge status="available" label="账号就绪" />
                  )}
                  {(acc.portalUser?.username || acc.portalUser?.loginEmail) && (
                    <p className="mt-1 text-[10px] text-text-muted">
                      {acc.portalUser.username || acc.portalUser.loginEmail}
                    </p>
                  )}
                </td>
                <td className="table-cell text-xs text-text-muted whitespace-nowrap">
                  {acc.portalUser?.lastLoginAt
                    ? new Date(acc.portalUser.lastLoginAt).toLocaleString()
                    : acc.lastLoginAt}
                </td>
                <td className="table-cell">
                  <div className="flex gap-2">
                    {can('account:assign') && (
                      <Button variant="ghost" size="sm" onClick={() => openEdit(acc)}>
                        <Pencil className="h-3 w-3" /> 权限
                      </Button>
                    )}
                    {can('account:disable') && (
                      <Button
                        variant={acc.status === 'active' ? 'danger-outline' : 'secondary'}
                        size="sm"
                        onClick={() => {
                          const action = acc.status === 'active' ? '禁用' : '启用'
                          const detail = acc.status === 'active' ? '禁用后该客户将无法登录。' : ''
                          if (!window.confirm(`确认${action}客户账号 ${acc.code}？${detail}`)) return
                          toggleAccountStatus(acc.id)
                        }}
                      >
                        {acc.status === 'active' ? <><Ban className="h-3 w-3" /> 禁用</> : <><Check className="h-3 w-3" /> 启用</>}
                      </Button>
                    )}
                    {can('account:manage') && (
                      <Button variant="ghost" size="sm" onClick={() => openPasswordReset(acc)}>
                        <KeyRound className="h-3 w-3" /> 重置密码
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <TableFooter total={accounts.length} />
      </Card>

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-sm" onClick={() => setCreating(false)}>
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-border-light" onClick={event => event.stopPropagation()}>
            <div className="border-b border-border-light px-6 py-4">
              <h3 className="font-semibold text-text-primary">新建客户账号</h3>
              <p className="mt-1 text-xs text-text-muted">客户主数据由 ERP 统一创建，同时开通 OMS 登录账号。</p>
            </div>
            <div className="grid grid-cols-1 gap-4 px-6 py-5 sm:grid-cols-2">
              <FormField label="客户代码" hint="可选；留空时由 ERP 自动生成">
                <input
                  className={formInput()}
                  value={createDraft.customerCode}
                  placeholder="如 TKL0001"
                  onChange={event => setCreateDraft(draft => ({ ...draft, customerCode: event.target.value }))}
                />
              </FormField>
              <FormField label="客户名称" required>
                <input className={formInput()} value={createDraft.customerName} onChange={event => setCreateDraft(draft => ({ ...draft, customerName: event.target.value }))} />
              </FormField>
              <FormField label="公司名称">
                <input className={formInput()} value={createDraft.companyName} onChange={event => setCreateDraft(draft => ({ ...draft, companyName: event.target.value }))} />
              </FormField>
              <FormField label="联系人">
                <input className={formInput()} value={createDraft.contactName} onChange={event => setCreateDraft(draft => ({ ...draft, contactName: event.target.value }))} />
              </FormField>
              <FormField label="联系邮箱" required>
                <input
                  type="email"
                  autoComplete="off"
                  className={formInput()}
                  value={createDraft.email}
                  onChange={event => setCreateDraft(draft => ({ ...draft, email: event.target.value }))}
                />
              </FormField>
              <FormField label="登录账号" hint="6-50 位字母、数字、点、下划线或短横线" required>
                <input
                  type="text"
                  autoComplete="off"
                  className={formInput()}
                  value={createDraft.username}
                  placeholder="例如 acme001"
                  onChange={event => setCreateDraft(draft => ({ ...draft, username: event.target.value }))}
                />
              </FormField>
              <FormField label="联系电话">
                <input className={formInput()} value={createDraft.contactPhone} onChange={event => setCreateDraft(draft => ({ ...draft, contactPhone: event.target.value }))} />
              </FormField>
              <FormField label="客户类型" required>
                <select
                  className={formSelect()}
                  value={createDraft.omsType}
                  onChange={event => {
                    const omsType = event.target.value as CustomerAccountType
                    setCreateDraft(draft => ({ ...draft, omsType, permissionTemplate: omsType }))
                  }}
                >
                  <option value="ecommerce">电商客户</option>
                  <option value="catalog">货盘客户</option>
                  <option value="hybrid">混合客户</option>
                </select>
              </FormField>
              <FormField label="仓库" required>
                <input
                  list="oms-warehouse-options"
                  className={formInput()}
                  value={createDraft.warehouse}
                  placeholder="选择或输入仓库代码"
                  onChange={event => setCreateDraft(draft => ({ ...draft, warehouse: event.target.value }))}
                />
                <datalist id="oms-warehouse-options">
                  <option value="WMS-JHB-01">JHB</option>
                  <option value="WMS-CPT-01">CPT</option>
                  <option value="WMS-DBN-01">DBN</option>
                </datalist>
              </FormField>
              <FormField label="权限模板" required>
                <select className={formSelect()} value={createDraft.permissionTemplate} onChange={event => setCreateDraft(draft => ({ ...draft, permissionTemplate: event.target.value as CustomerAccountType }))}>
                  <option value="ecommerce">电商客户模板</option>
                  <option value="catalog">货盘客户模板</option>
                  <option value="hybrid">混合客户模板</option>
                </select>
              </FormField>
              <FormField label="临时密码" hint="6-128 位" required>
                <input type="password" autoComplete="new-password" className={formInput()} value={createDraft.temporaryPassword} onChange={event => setCreateDraft(draft => ({ ...draft, temporaryPassword: event.target.value }))} />
              </FormField>
              <FormField label="确认临时密码" required>
                <input type="password" autoComplete="new-password" className={formInput()} value={createDraft.confirmPassword} onChange={event => setCreateDraft(draft => ({ ...draft, confirmPassword: event.target.value }))} />
              </FormField>
              {createError && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 sm:col-span-2">{createError}</div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-light px-6 py-4">
              <Button variant="secondary" onClick={() => setCreating(false)}>取消</Button>
              <Button disabled={createSaving} onClick={() => void createAccount()}>
                {createSaving ? '创建中…' : '创建 ERP 与 OMS 账户'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {resetting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-sm"
          onClick={() => { if (!resetSaving) setResetting(null) }}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-border-light"
            onClick={event => event.stopPropagation()}
          >
            <div className="border-b border-border-light px-6 py-4">
              <h3 className="font-semibold text-text-primary">重置临时密码 · {resetting.code}</h3>
              <p className="mt-1 text-xs text-text-muted">
                保存后现有密码立即失效，客户下次登录必须修改密码。
              </p>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div className="rounded-lg bg-surface-muted px-3 py-2.5 text-xs text-text-secondary">
                登录账号：{resetting.portalUser?.username || resetting.portalUser?.loginEmail || resetting.code}
              </div>
              <FormField label="临时密码" hint="6-128 位" required>
                <input
                  type="password"
                  autoComplete="new-password"
                  className={formInput()}
                  value={resetDraft.temporaryPassword}
                  disabled={resetSaving}
                  onChange={event => setResetDraft(draft => ({ ...draft, temporaryPassword: event.target.value }))}
                />
              </FormField>
              <FormField label="确认临时密码" required>
                <input
                  type="password"
                  autoComplete="new-password"
                  className={formInput()}
                  value={resetDraft.confirmPassword}
                  disabled={resetSaving}
                  onChange={event => setResetDraft(draft => ({ ...draft, confirmPassword: event.target.value }))}
                />
              </FormField>
              {resetError && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{resetError}</div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-light px-6 py-4">
              <Button variant="secondary" disabled={resetSaving} onClick={() => setResetting(null)}>
                取消
              </Button>
              <Button disabled={resetSaving} onClick={() => void resetTemporaryPassword()}>
                {resetSaving ? '保存中…' : '设置临时密码'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {priceBinding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-sm" onClick={() => setPriceBinding(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-border-light" onClick={e => e.stopPropagation()}>
            <div className="border-b border-border-light px-6 py-4">
              <h3 className="font-semibold text-text-primary">价格模板绑定 · {priceBinding.code}</h3>
              <p className="mt-1 text-xs text-text-muted">
                为 JHB / CPT / DBN 三个收货地区分别选择价格模板
              </p>
            </div>
            <div className="space-y-4 px-6 py-4">
              {dispatchRules.map(rule => {
                const regionTemplates = getPriceTemplatesForRegion(rule.code)
                return (
                  <FormField
                    key={rule.code}
                    label={regionLabel(rule.code, regionDispatchRules)}
                    hint={`默认配送：${rule.shippingMethod}`}
                  >
                    <select
                      className={formSelect()}
                      value={draftPriceByRegion[rule.code] ?? ''}
                      onChange={e => setDraftPriceByRegion(prev => ({
                        ...prev,
                        [rule.code]: e.target.value || null,
                      }))}
                    >
                      <option value="">该地区默认模板</option>
                      {regionTemplates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </FormField>
                )
              })}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-light px-6 py-4">
              <Button variant="secondary" onClick={() => setPriceBinding(null)}>取消</Button>
              <Button onClick={savePriceBinding}>保存绑定</Button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-sm" onClick={() => setEditing(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-border-light" onClick={e => e.stopPropagation()}>
            <div className="border-b border-border-light px-6 py-4">
              <h3 className="font-semibold text-text-primary">分配权限 · {editing.code}</h3>
              <p className="mt-1 text-xs text-text-muted">
                类型：{ACCOUNT_TYPE_LABELS[editing.type]} · {editing.email}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => applyTypeTemplate('ecommerce')} className="text-xs text-primary-600 hover:underline">套用电商模板</button>
                <span className="text-text-muted">|</span>
                <button type="button" onClick={() => applyTypeTemplate('catalog')} className="text-xs text-primary-600 hover:underline">套用货盘模板</button>
                <span className="text-text-muted">|</span>
                <button type="button" onClick={() => applyTypeTemplate('hybrid')} className="text-xs text-primary-600 hover:underline">套用混合模板</button>
              </div>
            </div>
            <div className="space-y-4 px-6 py-4">
              {PERMISSION_GROUPS.map(g => (
                <div key={g.label}>
                  <p className="mb-2 text-xs font-semibold text-text-secondary">{g.label}</p>
                  <div className="flex flex-wrap gap-2">
                    {g.permissions.map(p => (
                      <label
                        key={p}
                        className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                          draftPerms.includes(p) ? 'border-primary-400 bg-primary-50 text-primary-800' : 'border-border bg-white text-text-secondary'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={draftPerms.includes(p)}
                          onChange={() => togglePerm(p)}
                          className="rounded border-border text-primary-600"
                        />
                        {p.split(':')[1]}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-light px-6 py-4">
              <Button variant="secondary" onClick={() => setEditing(null)}>取消</Button>
              <Button onClick={savePerms}>保存权限</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
