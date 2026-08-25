import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, FileSearch, Plus, Trash2, ListOrdered, Upload } from 'lucide-react'
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
import { notifyIfUserError } from '../utils/userNotify'
import {
  detectTakealotDocKind,
  mergeTakealotParsed,
  parseTakealotDocumentText,
  parseTakealotFilename,
  toErpTakealotDestWh,
  type TakealotParsedDoc,
} from '../data/takealotDocParser'
import { extractPdfTextFromFile } from '../data/takealotPdfText'

interface LineItem {
  id: string
  sku: string
  name: string
  qty: number
}

type ReturnPlatform = 'takealot' | 'other'

const TAKEALOT_RETURN_FILE_KIND = 'takealot_return_booking'
const TAKEALOT_REASON_SCREENSHOT_KIND = 'takealot_return_reason_screenshot'
const TAKEALOT_SALES_30D_KIND = 'takealot_return_sales_30d'
const TAKEALOT_RETURNS_30D_KIND = 'takealot_return_returns_30d'
const OTHER_RETURN_FILE_KIND = 'other_platform_return_doc'

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
    returnPlatform: ReturnPlatform
    filledBy: string
    department: string
    selfRecall: 'yes' | 'no'
    inboundPoNumber: string
    purchasePrice: string
    userType: string
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
    returnPlatform: fields.returnPlatform,
    takealotReturnDetails: fields.returnPlatform === 'takealot' ? {
      filledBy: fields.filledBy.trim() || undefined,
      department: fields.department.trim() || undefined,
      selfRecall: fields.selfRecall,
      inboundPoNumber: fields.inboundPoNumber.trim() || undefined,
      purchasePrice: fields.purchasePrice ? Number(fields.purchasePrice) : undefined,
      userType: fields.userType.trim() || undefined,
    } : undefined,
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
  const [returnPlatform, setReturnPlatform] = useState<ReturnPlatform>('takealot')
  const [filledBy, setFilledBy] = useState('')
  const [department, setDepartment] = useState('')
  const [selfRecall, setSelfRecall] = useState<'yes' | 'no'>('yes')
  const [inboundPoNumber, setInboundPoNumber] = useState('')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [userType, setUserType] = useState('微信用户')
  const [recognizingFiles, setRecognizingFiles] = useState(false)
  const [recognitionHint, setRecognitionHint] = useState('')
  const [recognitionWarning, setRecognitionWarning] = useState('')
  const takealotFileInputRef = useRef<HTMLInputElement>(null)
  const otherFileInputRef = useRef<HTMLInputElement>(null)
  const reasonScreenshotInputRef = useRef<HTMLInputElement>(null)
  const sales30dInputRef = useRef<HTMLInputElement>(null)
  const returns30dInputRef = useRef<HTMLInputElement>(null)
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
    setFilledBy(existing.takealotReturnDetails?.filledBy ?? '')
    setDepartment(existing.takealotReturnDetails?.department ?? '')
    setSelfRecall(existing.takealotReturnDetails?.selfRecall ?? 'yes')
    setInboundPoNumber(existing.takealotReturnDetails?.inboundPoNumber ?? '')
    setPurchasePrice(existing.takealotReturnDetails?.purchasePrice?.toString() ?? '')
    setUserType(existing.takealotReturnDetails?.userType ?? '微信用户')
    setReturnPlatform(
      existing.returnPlatform || (existing.attachments?.some(attachment =>
        attachment.kind === TAKEALOT_RETURN_FILE_KIND
        || attachment.fileType === TAKEALOT_RETURN_FILE_KIND
        || attachment.kind === '预约单'
        || /^TAL[A-Z0-9]+\.pdf$/i.test(attachment.fileName)
      ) ? 'takealot' : 'other'),
    )
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
    returnPlatform,
    filledBy,
    department,
    selfRecall,
    inboundPoNumber,
    purchasePrice,
    userType,
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

  const applyRecognizedTakealot = (doc: TakealotParsedDoc) => {
    if (doc.bookingRef) setReferenceNo(doc.bookingRef)
    if (doc.appointmentDate) setExpectedArrivalAt(toDatetimeLocalInput(doc.appointmentDate))
    if (doc.sellerName) setSellerStoreName(doc.sellerName)
    const warehouse = toErpTakealotDestWh(doc.warehouseCode)
    if (warehouse && RETURN_WAREHOUSE_OPTIONS.some(option => option.value === warehouse)) {
      setReturnWarehouse(warehouse)
    }

    const details = [
      doc.bookingRef ? `预约编号 ${doc.bookingRef}` : '',
      doc.appointmentDate ? `预约时间 ${doc.appointmentDate.replace('T', ' ')}` : '',
      warehouse ? `仓库 ${warehouse}` : '',
      doc.totalUnits != null ? `退货数量 ${doc.totalUnits}` : '',
    ].filter(Boolean)
    setRecognitionHint(details.length ? details.join(' · ') : '已识别为 Takealot 文件，但未提取到可回填字段')
  }

  const mergeAttachments = (next: FileAttachment[]) => {
    const incomingNames = new Set(next.map(item => item.fileName))
    setAttachments(prev => [...prev.filter(item => !incomingNames.has(item.fileName)), ...next])
  }

  const onPickTakealotFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setRecognizingFiles(true)
    setRecognitionHint('')
    setRecognitionWarning('')
    try {
      const next: FileAttachment[] = []
      const takealotParts: Partial<TakealotParsedDoc>[] = []

      for (const file of Array.from(files)) {
        if (!/\.pdf$/i.test(file.name)) throw new Error('Takealot 预约退货文件必须是 PDF')
        let text = ''
        try {
          text = await extractPdfTextFromFile(file)
        } catch {
          // 扫描版 PDF 仍可继续按文件名识别。
        }
        const fromName = parseTakealotFilename(file.name)
        const looksTakealot = Boolean(
          fromName.bookingRef
          || /takealot|booking confirmation|booking reference number|date of booking/i.test(`${file.name}\n${text}`),
        )
        if (!looksTakealot) throw new Error(`“${file.name}”未识别为 Takealot 预约退货文件，请核对后重新上传`)
        const kind = detectTakealotDocKind(file.name, text)
        takealotParts.push(fromName)
        if (text.trim()) takealotParts.push(parseTakealotDocumentText(text, kind))
        const attachment = await fileToAttachment(file, TAKEALOT_RETURN_FILE_KIND)
        next.push({ ...attachment, fileType: TAKEALOT_RETURN_FILE_KIND, labelRole: 'sourceDocument' })
      }

      applyRecognizedTakealot(mergeTakealotParsed(...takealotParts))
      mergeAttachments(next)
    } catch (error) {
      setRecognitionWarning(error instanceof Error ? error.message : '文件识别失败，请重新上传')
    } finally {
      setRecognizingFiles(false)
      if (takealotFileInputRef.current) takealotFileInputRef.current.value = ''
    }
  }

  const onPickOtherPlatformFiles = async (files: FileList | null) => {
    if (!files?.length) return
    try {
      const next = await Promise.all(Array.from(files).map(async file => {
        const attachment = await fileToAttachment(file, OTHER_RETURN_FILE_KIND)
        return { ...attachment, fileType: OTHER_RETURN_FILE_KIND, labelRole: 'sourceDocument' }
      }))
      mergeAttachments(next)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '文件上传失败，请重新上传')
    } finally {
      if (otherFileInputRef.current) otherFileInputRef.current.value = ''
    }
  }

  const onPickSupportingFiles = async (files: FileList | null, fileKind: string) => {
    if (!files?.length) return
    try {
      const next = await Promise.all(Array.from(files).map(async file => {
        const attachment = await fileToAttachment(file, fileKind)
        return { ...attachment, fileType: fileKind, labelRole: 'sourceDocument' }
      }))
      mergeAttachments(next)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '资料上传失败，请重新上传')
    }
  }

  const removeAttachment = (fileName: string) => {
    setAttachments(prev => prev.filter(a => a.fileName !== fileName))
  }

  const takealotAttachments = attachments.filter(attachment =>
    attachment.kind === TAKEALOT_RETURN_FILE_KIND
    || attachment.fileType === TAKEALOT_RETURN_FILE_KIND
    || attachment.kind === '预约单'
    || /^TAL[A-Z0-9]+\.pdf$/i.test(attachment.fileName),
  )
  const reasonScreenshotAttachments = attachments.filter(attachment => attachment.kind === TAKEALOT_REASON_SCREENSHOT_KIND)
  const sales30dAttachments = attachments.filter(attachment => attachment.kind === TAKEALOT_SALES_30D_KIND)
  const returns30dAttachments = attachments.filter(attachment => attachment.kind === TAKEALOT_RETURNS_30D_KIND)
  const isTakealotAttachment = (attachment: FileAttachment) => (
    takealotAttachments.includes(attachment)
    || attachment.kind === TAKEALOT_REASON_SCREENSHOT_KIND
    || attachment.kind === TAKEALOT_SALES_30D_KIND
    || attachment.kind === TAKEALOT_RETURNS_30D_KIND
  )
  const otherPlatformAttachments = attachments.filter(attachment =>
    !isTakealotAttachment(attachment),
  )

  const renderAttachmentList = (files: FileAttachment[]) => files.length > 0 && (
    <ul className="mt-3 space-y-1.5">
      {files.map(attachment => (
        <li key={attachment.fileName} className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-xs ring-1 ring-border/70">
          <a href={attachment.url} target="_blank" rel="noreferrer" className="truncate text-primary-600 hover:underline">
            {attachment.fileName}
          </a>
          <button type="button" className="ml-3 shrink-0 text-red-500" onClick={() => removeAttachment(attachment.fileName)} aria-label={`删除 ${attachment.fileName}`}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  )

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
      notifyIfUserError(err, '导入失败')
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
    if (returnPlatform === 'takealot' && takealotAttachments.length === 0) {
      window.alert('请在上方上传 Takealot 平台预约退货文件')
      return
    }
    if (returnPlatform === 'takealot' && (!filledBy.trim() || !department.trim())) {
      window.alert('请填写 Takealot 退货资料中的填写人和所在部门')
      return
    }
    if (returnPlatform === 'takealot' && (!inboundPoNumber.trim() || !purchasePrice)) {
      window.alert('请填写 Takealot 退货资料中的送仓 PO Number 和当时采购价')
      return
    }
    if (returnPlatform === 'takealot' && reasonScreenshotAttachments.length === 0) {
      window.alert('请上传退货理由截图')
      return
    }
    if (returnPlatform === 'takealot' && (sales30dAttachments.length === 0 || returns30dAttachments.length === 0)) {
      window.alert('请上传近 30 天销售数据表和近 30 天退货数据')
      return
    }
    if (returnPlatform === 'other' && otherPlatformAttachments.length === 0) {
      window.alert('请在下方上传其他平台退货文件')
      return
    }
    if (!orderNo.trim()) {
      window.alert(returnPlatform === 'takealot' ? '请填写系统退货 ID' : '请填写订单号')
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
          <div className="mb-5 grid gap-4 md:grid-cols-3">
            <FormField label="退货平台" required hint="只有 Takealot 支持 PDF 自动识别">
              <select
                className={formSelect()}
                value={returnPlatform}
                onChange={event => {
                  setReturnPlatform(event.target.value as ReturnPlatform)
                  setRecognitionWarning('')
                }}
              >
                <option value="takealot">Takealot</option>
                <option value="other">其他平台</option>
              </select>
            </FormField>
            <div className="md:col-span-2">
              <p className="mb-1.5 text-xs font-medium text-text-secondary">
                {returnPlatform === 'takealot' ? 'Takealot 自动识别结果' : '文件处理方式'}
              </p>
              {returnPlatform === 'takealot' ? (
                <div className={`flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-xs ring-1 ${
                  recognitionWarning
                    ? 'bg-amber-50 text-amber-800 ring-amber-200'
                    : recognitionHint
                      ? 'bg-green-50 text-green-800 ring-green-200'
                      : 'bg-surface-muted text-text-muted ring-border'
                }`}>
                  {recognitionWarning
                    ? <AlertTriangle className="h-4 w-4 shrink-0" />
                    : recognitionHint
                      ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                      : <FileSearch className="h-4 w-4 shrink-0" />}
                  <span>{recognitionWarning || recognitionHint || '等待上传 Takealot PDF'}</span>
                </div>
              ) : (
                <div className="flex min-h-10 items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
                  <Upload className="h-4 w-4 shrink-0" />
                  <span>其他平台只保存上传文件，不读取、不识别、不自动回填内容。</span>
                </div>
              )}
            </div>
          </div>

          {returnPlatform === 'takealot' && <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-blue-900">① Takealot 平台退货文件（上方）</p>
                <p className="mt-1 text-xs text-blue-700">上传平台预约退货 PDF，系统自动读取预约编号、时间、仓库和退货数量。</p>
              </div>
              <div className="flex items-center gap-2">
                {takealotAttachments.length > 0 && (
                  <span className="text-xs text-blue-700">已上传 {takealotAttachments.length} 个</span>
                )}
                <input
                  ref={takealotFileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  multiple
                  className="hidden"
                  onChange={event => void onPickTakealotFiles(event.target.files)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={recognizingFiles}
                  onClick={() => takealotFileInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" /> {recognizingFiles ? '识别中…' : '上传 Takealot PDF'}
                </Button>
              </div>
            </div>
            {renderAttachmentList(takealotAttachments)}
          </div>}

          {returnPlatform === 'other' && <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-amber-900">② 其他平台退货文件（下方）</p>
                <p className="mt-1 text-xs text-amber-700">普通上传：保存退货凭证、面单、截图或相关资料，不进行自动识别。</p>
              </div>
              <div className="flex items-center gap-2">
                {otherPlatformAttachments.length > 0 && (
                  <span className="text-xs text-amber-700">已上传 {otherPlatformAttachments.length} 个</span>
                )}
                <input
                  ref={otherFileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={event => void onPickOtherPlatformFiles(event.target.files)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => otherFileInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" /> 上传其他平台文件
                </Button>
              </div>
            </div>
            {renderAttachmentList(otherPlatformAttachments)}
          </div>}

          {returnPlatform === 'takealot' && (
            <div className="mb-5 rounded-xl border border-blue-100 bg-white p-4 ring-1 ring-blue-50">
              <div className="mb-4">
                <p className="text-sm font-semibold text-text-primary">Takealot 退货资料</p>
                <p className="mt-1 text-xs text-text-muted">字段与《货盘退货收集表》一致；带 * 的内容提交前必须填写或上传。</p>
              </div>
              <FormGrid cols={3}>
                <FormField label="填写人" required>
                  <input className={formInput()} value={filledBy} onChange={e => setFilledBy(e.target.value)} />
                </FormField>
                <FormField label="所在部门" required>
                  <input className={formInput()} value={department} onChange={e => setDepartment(e.target.value)} />
                </FormField>
                <FormField label="填写时间">
                  <input type="date" className={formInput()} value={createdAt} onChange={e => setCreatedAt(e.target.value)} />
                </FormField>
                <FormField label="自主选择是否收回" required>
                  <select className={formSelect()} value={selfRecall} onChange={e => setSelfRecall(e.target.value as 'yes' | 'no')}>
                    <option value="yes">是，收回</option>
                    <option value="no">否，不收回</option>
                  </select>
                </FormField>
                <FormField label="送仓 PO Number" required hint="用于核对采购价">
                  <input className={formInput()} value={inboundPoNumber} onChange={e => setInboundPoNumber(e.target.value)} />
                </FormField>
                <FormField label="当时采购价" required>
                  <input type="number" min="0" step="0.01" className={formInput()} value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} />
                </FormField>
                <FormField label="用户类型" required>
                  <select className={formSelect()} value={userType} onChange={e => setUserType(e.target.value)}>
                    <option value="微信用户">微信用户</option>
                    <option value="电商客户">电商客户</option>
                    <option value="其他">其他</option>
                  </select>
                </FormField>
                <FormField label="对应的客户代码">
                  <input className={formInput()} value={customerCode || ''} readOnly placeholder="选择客户端后自动带出" />
                </FormField>
              </FormGrid>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {[
                  { label: '退货理由截图', required: true, files: reasonScreenshotAttachments, ref: reasonScreenshotInputRef, kind: TAKEALOT_REASON_SCREENSHOT_KIND, accept: 'image/*' },
                  { label: '近 30 天销售数据表', required: true, files: sales30dAttachments, ref: sales30dInputRef, kind: TAKEALOT_SALES_30D_KIND, accept: '.xlsx,.xls,.csv' },
                  { label: '近 30 天退货数据', required: true, files: returns30dAttachments, ref: returns30dInputRef, kind: TAKEALOT_RETURNS_30D_KIND, accept: '.xlsx,.xls,.csv' },
                ].map(item => (
                  <div key={item.kind} className="rounded-lg bg-blue-50/60 p-3 ring-1 ring-blue-100">
                    <p className="text-xs font-medium text-text-secondary">{item.label} {item.required && <span className="text-red-500">*</span>}</p>
                    <input ref={item.ref} type="file" accept={item.accept} multiple className="hidden" onChange={event => void onPickSupportingFiles(event.target.files, item.kind)} />
                    <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => item.ref.current?.click()}>
                      <Upload className="h-3.5 w-3.5" /> 上传资料
                    </Button>
                    {renderAttachmentList(item.files)}
                  </div>
                ))}
              </div>
            </div>
          )}

          <FormGrid cols={3}>
            <FormField label="退件单号">
              <input className={formInput()} value={returnNo} readOnly placeholder="自动生成" />
            </FormField>
            <FormField label={returnPlatform === 'takealot' ? '系统退货 ID' : '订单号'} required>
              <input className={formInput()} value={orderNo} onChange={e => setOrderNo(e.target.value)} placeholder="ORD-..." />
            </FormField>
            <FormField label={returnPlatform === 'takealot' ? 'Takealot 预约编号' : '参考号'} hint={returnPlatform === 'takealot' ? '上传预约 PDF 后自动带出' : undefined}>
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
            <FormField label={returnPlatform === 'takealot' ? '退货的仓库' : '退件仓库'} required>
              <select className={formSelect()} value={returnWarehouse} onChange={e => setReturnWarehouse(e.target.value)}>
                {RETURN_WAREHOUSE_OPTIONS.map(w => (
                  <option key={w.value} value={w.value}>{w.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label={returnPlatform === 'takealot' ? '预约退货时间（月、日、时）' : '预计到货时间'}>
              <input
                type="datetime-local"
                className={formInput()}
                value={expectedArrivalAt}
                onChange={e => setExpectedArrivalAt(e.target.value)}
              />
            </FormField>
            <FormField label={returnPlatform === 'takealot' ? '退货原因' : '退件原因'} required>
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
