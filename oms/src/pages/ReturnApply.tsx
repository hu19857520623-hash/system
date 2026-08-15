import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Trash2, ListOrdered, Upload } from 'lucide-react'
import { Button, Card, MonoCode, Table } from '../components/ui'
import SkuFuzzyPicker from '../components/ui/SkuFuzzyPicker'
import { FormSection, FormGrid, FormField, formInput, formSelect, formTextarea } from '../components/ui/form'
import { findProductBySku } from '../data/inventoryStore'
import { findProductByCode } from '../data/platformBindingUtils'
import { getCustomerSkuDisplay } from '../data/skuCode'
import { useRole } from '../auth/RoleContext'
import { resolveErpCustomerContext, getCustomerIdForRole } from '../data/dataScope'
import { AdminCustomerFilter } from '../components/admin/AdminCustomerFilter'
import { useDataScope } from '../auth/useDataScope'
import {
  addReturnOrder,
  getReturnOrdersSnapshot,
  updateReturnOrder,
} from '../data/entityStore'
import {
  RETURN_PROCESS_OPTIONS,
  RETURN_WAREHOUSE_OPTIONS,
  canEditReturnOrder,
  nextReturnNo,
  submitReturnToErp,
  type ReturnOrder,
} from '../data/returnStore'
import { todayDateInput, toDatetimeLocalInput, fromDatetimeLocalInput, fileToAttachment } from '../data/fileUtils'
import { importCsvFile } from '../data/csvImportExport'
import {
  RETURN_LINE_COLUMNS,
  downloadReturnLineTemplate,
  parseReturnLines,
} from '../data/importTemplates'
import { ImportTemplateLegend } from '../components/ui/ImportTemplateLegend'
import type { FileAttachment, Product } from '../data/mockData'

interface LineItem {
  id: string
  sku: string
  name: string
  qty: number
}

const RETURN_REASONS = [
  '客户拒收',
  '包装破损',
  '发错商品',
  '质量问题',
  '平台退货',
  '其他',
]

function buildReturnOrder(
  fields: {
    editingId: string | null
    returnNo: string
    customerId?: string
    orderNo: string
    referenceNo: string
    trackingNo: string
    sellerStoreName: string
    sellerTaxNo: string
    returnWarehouse: string
    expectedArrivalAt: string
    returnReason: string
    returnDescription: string
    requestedProcess: string
    remark: string
    lines: LineItem[]
    attachments: FileAttachment[]
    createdAt: string
  },
  asDraft: boolean,
): ReturnOrder {
  const totalQty = fields.lines.reduce((s, l) => s + l.qty, 0)
  return {
    id: fields.editingId || `rt-${Date.now()}`,
    customerId: fields.customerId,
    returnNo: fields.returnNo,
    orderNo: fields.orderNo.trim(),
    referenceNo: fields.referenceNo.trim() || undefined,
    trackingNo: fields.trackingNo.trim() || undefined,
    sellerStoreName: fields.sellerStoreName.trim() || undefined,
    sellerTaxNo: fields.sellerTaxNo.trim() || undefined,
    returnWarehouse: fields.returnWarehouse,
    expectedArrivalAt: fromDatetimeLocalInput(fields.expectedArrivalAt) || undefined,
    returnReason: fields.returnReason.trim(),
    returnDescription: fields.returnDescription.trim() || undefined,
    requestedProcess: fields.requestedProcess,
    status: asDraft ? 'draft' : 'pending_arrival',
    statusLabel: asDraft ? '草稿' : '待到货',
    createdAt: fields.createdAt,
    lineItems: fields.lines,
    attachments: fields.attachments.length ? fields.attachments : undefined,
    totalQty,
    remark: fields.remark.trim() || undefined,
  }
}

export default function ReturnApply() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('edit')
  const { role } = useRole()
  const dataScope = useDataScope()
  const customerIdFromRole = getCustomerIdForRole(role) ?? undefined

  const [editingId, setEditingId] = useState<string | null>(editId)
  const [returnNo, setReturnNo] = useState('')
  const [orderNo, setOrderNo] = useState('')
  const [referenceNo, setReferenceNo] = useState('')
  const [trackingNo, setTrackingNo] = useState('')
  const [sellerStoreName, setSellerStoreName] = useState('')
  const [sellerTaxNo, setSellerTaxNo] = useState('')
  const [returnWarehouse, setReturnWarehouse] = useState('JHB3')
  const [expectedArrivalAt, setExpectedArrivalAt] = useState('')
  const [returnReason, setReturnReason] = useState('')
  const [returnDescription, setReturnDescription] = useState('')
  const [requestedProcess, setRequestedProcess] = useState('pending_inspection')
  const [remark, setRemark] = useState('')
  const [skuInput, setSkuInput] = useState('')
  const [qtyInput, setQtyInput] = useState('')
  const [lines, setLines] = useState<LineItem[]>([])
  const [attachments, setAttachments] = useState<FileAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [createdAt, setCreatedAt] = useState(todayDateInput())
  const [draftCustomerId, setDraftCustomerId] = useState<string | undefined>()
  const [reEditingCancelled, setReEditingCancelled] = useState(false)

  const erpCustomer = resolveErpCustomerContext({
    role,
    customerId: draftCustomerId,
    adminCustomerFilter: dataScope.customerFilter,
    accounts: dataScope.customerOptions,
  })
  const customerId = erpCustomer?.customerId
  const customerCode = erpCustomer?.customerCode

  useEffect(() => {
    if (dataScope.isAdmin && dataScope.customerFilter !== 'all') {
      setDraftCustomerId(dataScope.customerFilter)
    }
  }, [dataScope.isAdmin, dataScope.customerFilter])

  useEffect(() => {
    if (!editId) {
      setReturnNo(prev => prev || nextReturnNo())
      setDraftCustomerId(customerIdFromRole)
      return
    }
    const existing = getReturnOrdersSnapshot().find(o => o.id === editId)
    if (!existing || !canEditReturnOrder(existing)) {
      window.alert('该退件单不可编辑（仅草稿或已撤回可修改）')
      navigate('/returns/processing')
      return
    }
    setReEditingCancelled(existing.status === 'cancelled')
    setDraftCustomerId(existing.customerId ?? customerIdFromRole)
    setEditingId(existing.id)
    setReturnNo(existing.returnNo)
    setCreatedAt(existing.createdAt)
    setOrderNo(existing.orderNo)
    setReferenceNo(existing.referenceNo ?? '')
    setTrackingNo(existing.trackingNo ?? '')
    setSellerStoreName(existing.sellerStoreName ?? '')
    setSellerTaxNo(existing.sellerTaxNo ?? '')
    setReturnWarehouse(existing.returnWarehouse ?? 'JHB3')
    setExpectedArrivalAt(toDatetimeLocalInput(existing.expectedArrivalAt))
    setReturnReason(existing.returnReason)
    setReturnDescription(existing.returnDescription ?? '')
    setRequestedProcess(existing.requestedProcess)
    setRemark(existing.remark ?? '')
    setAttachments(existing.attachments ?? [])
    setLines(existing.lineItems.map((l, i) => ({
      id: `${existing.id}-line-${i}`,
      sku: l.sku,
      name: l.name,
      qty: l.qty,
    })))
  }, [editId, navigate, customerIdFromRole])

  const requireCustomer = () => {
    if (customerId && customerCode) return true
    window.alert(
      dataScope.isAdmin
        ? '请先在上方选择要代操作的客户端，再提交退件'
        : '当前角色未绑定 ERP 客户编码，请联系管理员配置账号 code（需与 ERP customer_code 一致）',
    )
    return false
  }

  const formFields = () => ({
    editingId,
    returnNo: returnNo || nextReturnNo(),
    customerId,
    orderNo,
    referenceNo,
    trackingNo,
    sellerStoreName,
    sellerTaxNo,
    returnWarehouse,
    expectedArrivalAt,
    returnReason,
    returnDescription,
    requestedProcess,
    remark,
    lines,
    attachments,
    createdAt,
  })

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const next: FileAttachment[] = []
    for (const file of Array.from(files)) {
      next.push(await fileToAttachment(file, 'return_doc'))
    }
    setAttachments(prev => [...prev, ...next])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeAttachment = (fileName: string) => {
    setAttachments(prev => prev.filter(a => a.fileName !== fileName))
  }

  const addLine = () => {
    if (!skuInput.trim() || !qtyInput) return
    const prod = findProductByCode(skuInput.trim(), customerId)
    const internalSku = prod?.internalSku ?? skuInput.trim()
    setLines(prev => [...prev, {
      id: String(Date.now()),
      sku: internalSku,
      name: prod?.name ?? skuInput.trim(),
      qty: Number(qtyInput),
    }])
    setSkuInput('')
    setQtyInput('')
  }

  const onSkuSelect = (product: Product) => {
    setSkuInput(getCustomerSkuDisplay(product))
  }

  const handleBatchUploadLines = async () => {
    try {
      const { data, errors } = await importCsvFile(RETURN_LINE_COLUMNS, parseReturnLines)
      if (errors.length > 0) {
        window.alert(`导入失败：\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? `\n…共 ${errors.length} 条` : ''}`)
        return
      }
      if (data.length === 0) {
        window.alert('未解析到有效明细，请使用最新模板')
        return
      }
      setLines(prev => [...prev, ...data])
      window.alert(`已导入 ${data.length} 行退件 SKU 明细`)
    } catch (err) {
      if ((err as Error).message !== 'cancelled') console.error(err)
    }
  }

  const handleSaveDraft = () => {
    setSavingDraft(true)
    try {
      const order = buildReturnOrder(formFields(), true)
      if (editingId) {
        updateReturnOrder(editingId, order)
      } else {
        addReturnOrder(order)
      }
      window.alert(`草稿已保存：${order.returnNo}`)
      navigate('/returns/processing?tab=draft')
    } finally {
      setSavingDraft(false)
    }
  }

  const handleSubmit = async () => {
    if (!requireCustomer()) return
    if (!orderNo.trim()) {
      window.alert('请填写订单号')
      return
    }
    if (!returnReason.trim()) {
      window.alert('请选择或填写退件原因')
      return
    }
    if (!returnWarehouse) {
      window.alert('请选择退件仓库')
      return
    }
    if (lines.length === 0) {
      window.alert('请添加 SKU 明细')
      return
    }
    const order = buildReturnOrder(formFields(), false)
    setSubmitting(true)
    const result = await submitReturnToErp(order, { customerId, customerCode })
    setSubmitting(false)
    if (!result.ok) {
      const draftOrder = { ...order, status: 'draft', statusLabel: '草稿' }
      if (editingId) updateReturnOrder(editingId, draftOrder)
      else addReturnOrder(draftOrder)
      window.alert(`提交失败，已自动保存为草稿，表单数据不会丢失：${result.error}`)
      navigate('/returns/processing?tab=draft')
      return
    }
    window.alert(`退件单 ${result.order.returnNo} 已提交，仓库到货后将更新处理进度`)
    navigate('/returns/processing')
  }

  return (
    <div className="page-shell">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-primary-600">Return · 预约退件</p>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">预约退件</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {reEditingCancelled
              ? `重新编辑已撤回退件 ${returnNo}，修改后可再次提交（如重新上架）`
              : editingId
                ? `编辑草稿 ${returnNo}`
                : '填写退件信息与 SKU 明细，可先保存草稿再提交'}
          </p>
        </div>
        <Link to="/returns/processing" className="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:underline">
          <ListOrdered className="h-3.5 w-3.5" /> 查看退件处理
        </Link>
      </div>

      <div className="space-y-6">
        {dataScope.isAdmin && (
          <Card className="p-4">
            <AdminCustomerFilter scope={dataScope} />
            <p className="mt-2 text-xs text-text-muted">管理员代客提交退件前，请先选择客户端（客户编码需与 ERP 一致，如 TKL0001）</p>
          </Card>
        )}
        <FormSection num={1} title="退件信息">
          <FormGrid cols={3}>
            <FormField label="退件单号">
              <input className={formInput()} value={returnNo} readOnly placeholder="自动生成" />
            </FormField>
            <FormField label="订单号" required>
              <input className={formInput()} value={orderNo} onChange={e => setOrderNo(e.target.value)} placeholder="ORD-..." />
            </FormField>
            <FormField label="参考号">
              <input className={formInput()} value={referenceNo} onChange={e => setReferenceNo(e.target.value)} />
            </FormField>
            <FormField label="跟踪号">
              <input className={formInput()} value={trackingNo} onChange={e => setTrackingNo(e.target.value)} />
            </FormField>
            <FormField label="卖家店铺名称">
              <input className={formInput()} value={sellerStoreName} onChange={e => setSellerStoreName(e.target.value)} />
            </FormField>
            <FormField label="卖家税号">
              <input className={formInput()} value={sellerTaxNo} onChange={e => setSellerTaxNo(e.target.value)} />
            </FormField>
            <FormField label="退件仓库" required>
              <select className={formSelect()} value={returnWarehouse} onChange={e => setReturnWarehouse(e.target.value)}>
                {RETURN_WAREHOUSE_OPTIONS.map(w => (
                  <option key={w.value} value={w.value}>{w.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="预计到货时间">
              <input
                type="datetime-local"
                className={formInput()}
                value={expectedArrivalAt}
                onChange={e => setExpectedArrivalAt(e.target.value)}
              />
            </FormField>
            <FormField label="退件原因" required>
              <select className={formSelect()} value={returnReason} onChange={e => setReturnReason(e.target.value)}>
                <option value="">请选择</option>
                {RETURN_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </FormField>
            <FormField label="处理方式" required>
              <select className={formSelect()} value={requestedProcess} onChange={e => setRequestedProcess(e.target.value)}>
                {RETURN_PROCESS_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </FormField>
          </FormGrid>
          <FormField label="退件说明" className="mt-4">
            <textarea className={formTextarea()} rows={3} value={returnDescription} onChange={e => setReturnDescription(e.target.value)} />
          </FormField>
          <FormField label="备注" className="mt-4">
            <input className={formInput()} value={remark} onChange={e => setRemark(e.target.value)} />
          </FormField>
          <div className="mt-4">
            <FormField label="附件" hint="可上传退件照片、面单、平台退货凭证等">
              <div className="flex flex-wrap items-start gap-3">
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => void onPickFiles(e.target.files)} />
                <Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" /> 上传文件
                </Button>
                {attachments.length > 0 && (
                  <span className="pt-1 text-xs text-text-muted">已选 {attachments.length} 个文件</span>
                )}
              </div>
              {attachments.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {attachments.map(a => (
                    <li key={a.fileName} className="flex items-center justify-between rounded bg-surface-muted px-2 py-1 text-xs">
                      <a href={a.url} target="_blank" rel="noreferrer" className="truncate text-primary-600 hover:underline">{a.fileName}</a>
                      <button type="button" className="ml-2 text-red-500" onClick={() => removeAttachment(a.fileName)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </FormField>
          </div>
        </FormSection>

        <FormSection
          num={2}
          title="SKU 明细"
          action={(
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={downloadReturnLineTemplate}>下载模板</Button>
              <Button variant="secondary" size="sm" onClick={() => void handleBatchUploadLines()}>
                <Upload className="h-3.5 w-3.5" /> 批量上传
              </Button>
            </div>
          )}
        >
          <ImportTemplateLegend columns={RETURN_LINE_COLUMNS} />
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <FormField label="SKU" className="min-w-[240px] flex-1">
              <SkuFuzzyPicker
                value={skuInput}
                onChange={setSkuInput}
                onSelect={onSkuSelect}
                customerId={customerId}
              />
            </FormField>
            <FormField label="数量">
              <input
                type="number"
                min={1}
                className={formInput()}
                value={qtyInput}
                onChange={e => setQtyInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLine() } }}
              />
            </FormField>
            <Button type="button" size="sm" onClick={addLine}><Plus className="h-3.5 w-3.5" /> 添加</Button>
          </div>
          <Card className="overflow-hidden">
            <Table>
              <thead className="table-head">
                <tr>
                  <th>SKU</th>
                  <th>商品名称</th>
                  <th>数量</th>
                  <th />
                </tr>
              </thead>
              <tbody className="table-body">
                {lines.map(l => (
                  <tr key={l.id} className="table-row">
                    <td className="table-cell"><MonoCode>{getCustomerSkuDisplay(findProductBySku(l.sku) ?? { internalSku: l.sku })}</MonoCode></td>
                    <td className="table-cell text-xs">{l.name}</td>
                    <td className="table-cell text-xs">{l.qty}</td>
                    <td className="table-cell">
                      <button type="button" className="text-red-500" onClick={() => setLines(prev => prev.filter(x => x.id !== l.id))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr><td colSpan={4} className="table-cell py-8 text-center text-sm text-text-muted">请添加退件 SKU，或使用批量上传</td></tr>
                )}
              </tbody>
            </Table>
          </Card>
        </FormSection>

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => navigate('/returns/processing')}>取消</Button>
          <Button variant="secondary" disabled={savingDraft || submitting} onClick={handleSaveDraft}>
            {savingDraft ? '保存中…' : '保存草稿'}
          </Button>
          <Button disabled={submitting || savingDraft} onClick={() => void handleSubmit()}>
            {submitting ? '提交中…' : '提交退件申请'}
          </Button>
        </div>
      </div>
    </div>
  )
}
