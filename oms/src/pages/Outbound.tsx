import { useMemo, useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Link2, ListOrdered, Plus, Trash2, Upload, XCircle } from 'lucide-react'
import { Button, Card, MonoCode, Table } from '../components/ui'
import { FormSection, FormGrid, FormField, formInput, formSelect, formTextarea } from '../components/ui/form'
import {
  FULFILLMENT_WAREHOUSES, warehouseLabel,
  LOGISTICS_CHANNELS, PLATFORM_OPTIONS, formatCurrency,
  TAKEALOT_ATTACHMENT_KINDS,
  type FileAttachment, type OutboundOrder, type OutboundType, type PlatformSkuMapping,
  type ShipmentSource, type StockSource, type TakealotAttachmentKind,
} from '../data/mockData'
import { getOutboundShippableQty, lockStockForOutbound, rollbackStockForOutbound, useInventoryItems, useProducts } from '../data/inventoryStore'
import { addOutboundOrderOrThrow, nextOutboundNo, removeOutboundOrder, submitOutboundToErp, useOutboundOrders } from '../data/outboundStore'
import { getCustomerCode, getCustomerIdForRole } from '../data/dataScope'
import {
  TAKEALOT_DOWNLOAD_ITEMS,
} from '../data/customerShipFlows'
import {
  findProductByCode,
  findTakealotStoresForSeller,
  pickTakealotStoreForBinding,
  resolvePlatformBarcodes,
  type PlatformBarcodeResolution,
} from '../data/platformBindingUtils'
import {
  calculateOutboundPreDeduct, warehouseIdToRegion,
  enabledDispatchRules, findDispatchRuleForRegion, regionDispatchLabel, regionLabel,
} from '../data/feeTemplates'
import { useFeeTemplates, getPriceTemplateForCustomer } from '../data/feeTemplateStore'
import { preDeductOutboundFees, rollbackPreDeductOutboundFees, useBilling } from '../data/billingStore'
import { useRole } from '../auth/RoleContext'
import { useDataScope } from '../auth/useDataScope'
import { fileToAttachment, todayDateInput } from '../data/fileUtils'
import {
  describeTakealotParsed,
  detectTakealotDocKind,
  mergeTakealotParsed,
  parseTakealotDocumentText,
  parseTakealotFilename,
  takealotIdentityConflicts,
  takealotMissingFields,
  takealotParseConflicts,
  takealotParseWarnings,
  type TakealotDocKind,
  type TakealotParsedDoc,
} from '../data/takealotDocParser'
import { extractPdfTextFromFile } from '../data/takealotPdfText'
import {
  isValidEan13,
  parseTakealotProductLabelPdf,
  type TakealotLabelPdfResult,
} from '../data/takealotLabelPdf'
import { importCsvFile } from '../data/csvImportExport'
import {
  OUTBOUND_LINE_COLUMNS,
  downloadOutboundLineTemplate,
  parseOutboundLines,
} from '../data/importTemplates'
import { ImportTemplateLegend } from '../components/ui/ImportTemplateLegend'
import SkuFuzzyPicker from '../components/ui/SkuFuzzyPicker'
import PlatformBindingModal, { type BindingFormState } from '../components/platform/PlatformBindingModal'
import {
  setPlatformSkuMappings,
  usePlatformSkuMappings,
  useStores,
} from '../data/entityStore'
import { apiPut } from '../api/client'
import { notifyIfUserError } from '../utils/userNotify'

const OUTBOUND_TYPES = ['Takealot入仓', '一件代发', '中转出库'] as const

const SHIP_WAREHOUSE_ID = 'jhb'
const DEFAULT_TAKEALOT_DEST_WAREHOUSE = 'jhb3'

const DOC_KIND_TO_FILE_TYPE: Record<string, TakealotAttachmentKind> = {
  '外箱标': TAKEALOT_ATTACHMENT_KINDS.outerLabel,
  'SKU 标签': TAKEALOT_ATTACHMENT_KINDS.skuLabel,
  '发货清单': TAKEALOT_ATTACHMENT_KINDS.deliveryList,
  '预约单': TAKEALOT_ATTACHMENT_KINDS.appointment,
}

const FILE_TYPE_TO_DOC_KIND: Record<TakealotAttachmentKind, TakealotDocKind> = {
  outerLabel: '外箱标',
  skuLabel: 'SKU 标签',
  deliveryList: '发货清单',
  appointment: '预约单',
}

interface LineItem {
  id: string
  sku: string
  name: string
  qty: number
  declaredName: string
  declaredValue: number
  note: string
  source?: 'manual' | 'takealot'
}

interface TakealotValidationRow {
  barcode: string
  title?: string
  expectedQty: number
  observedQty: number
  cropCount: number
  resolution: PlatformBarcodeResolution
  issues: string[]
}

export default function Outbound() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('edit')
  const outboundOrders = useOutboundOrders()
  const editOrder = editId ? outboundOrders.find(order => order.id === editId && order.status === 'draft') : undefined
  const { role, can } = useRole()
  const dataScope = useDataScope()
  const [takealotDestWarehouse, setTakealotDestWarehouse] = useState<string>(DEFAULT_TAKEALOT_DEST_WAREHOUSE)
  const [platform, setPlatform] = useState<string>(PLATFORM_OPTIONS[0])
  const [outboundType, setOutboundType] = useState<string>('Takealot入仓')
  const [shippingMethod, setShippingMethod] = useState<string>(LOGISTICS_CHANNELS[0])
  const [refNo, setRefNo] = useState('')
  const [sellerStoreName, setSellerStoreName] = useState('')
  const [takealotSellerId, setTakealotSellerId] = useState('')
  const [takealotBookingRef, setTakealotBookingRef] = useState('')
  const [shipmentDueDate, setShipmentDueDate] = useState('')
  const [scheduledDeliveryDate, setScheduledDeliveryDate] = useState('')
  const [takealotParseHint, setTakealotParseHint] = useState('')
  const [takealotParsedDoc, setTakealotParsedDoc] = useState<TakealotParsedDoc | null>(null)
  const [takealotLabelResults, setTakealotLabelResults] = useState<Record<string, TakealotLabelPdfResult>>({})
  const [parseBusy, setParseBusy] = useState(false)
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [draggingFiles, setDraggingFiles] = useState(false)
  const [remark, setRemark] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [recipientProvince, setRecipientProvince] = useState('')
  const [recipientCity, setRecipientCity] = useState('')
  const [recipientPostalCode, setRecipientPostalCode] = useState('')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [recipientAddress1, setRecipientAddress1] = useState('')
  const [recipientAddress2, setRecipientAddress2] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [attachments, setAttachments] = useState<FileAttachment[]>([])
  const [skuInput, setSkuInput] = useState('')
  const [qtyInput, setQtyInput] = useState('')
  const [declaredNameInput, setDeclaredNameInput] = useState('')
  const [declaredValueInput, setDeclaredValueInput] = useState('')
  const [noteInput, setNoteInput] = useState('')
  const [lines, setLines] = useState<LineItem[]>([])
  const [destRegion, setDestRegion] = useState('jhb')
  const [dispatchRuleId, setDispatchRuleId] = useState('')
  const [quickBindTarget, setQuickBindTarget] = useState<{ barcode: string; title?: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const generalAttachmentRef = useRef<HTMLInputElement>(null)
  const takealotFileRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const takealotParsedParts = useRef<Map<string, Partial<TakealotParsedDoc>[]>>(new Map())
  const destinationExplicitlySelected = useRef(false)
  const hydratedEditId = useRef<string | null>(null)
  const platformMappings = usePlatformSkuMappings()
  const stores = useStores()

  const { regionDispatchRules } = useFeeTemplates()
  const activeDispatchRules = useMemo(
    () => enabledDispatchRules(regionDispatchRules),
    [regionDispatchRules],
  )

  const isDropship = outboundType === '一件代发'
  const isTakealot = outboundType === 'Takealot入仓'
  const takealotAttachmentKinds = useMemo(
    () => new Set(Object.values(TAKEALOT_ATTACHMENT_KINDS)),
    [],
  )
  const allProducts = useProducts()
  useInventoryItems()
  const catalogOnly = role === 'catalog'
  const stockSource: StockSource = catalogOnly ? 'catalog' : 'owned'
  const { creditBalance } = useBilling()

  const effectiveDestRegion = isTakealot
    ? warehouseIdToRegion(takealotDestWarehouse)
    : destRegion

  const customerId = getCustomerIdForRole(role)
  const effectiveTakealotSellerId = (takealotParsedDoc?.sellerId || takealotSellerId.trim()) || undefined
  const quickBindStore = useMemo(
    () => pickTakealotStoreForBinding(effectiveTakealotSellerId, customerId ?? undefined),
    [effectiveTakealotSellerId, customerId],
  )
  const priceTemplate = useMemo(
    () => getPriceTemplateForCustomer(customerId, effectiveDestRegion),
    [customerId, effectiveDestRegion, role],
  )

  const resolveLineSku = (input: string) => findProductByCode(input)?.internalSku || input.trim()

  const getShippableQty = (sku: string) => getOutboundShippableQty(sku, stockSource, customerId ?? undefined)

  const getRemainingShippableQty = (sku: string, excludeLineId?: string) => {
    const normalized = resolveLineSku(sku)
    if (!normalized) return 0
    const reserved = lines
      .filter(line => line.id !== excludeLineId && resolveLineSku(line.sku) === normalized)
      .reduce((sum, line) => sum + Math.max(0, Number(line.qty) || 0), 0)
    return Math.max(0, getShippableQty(normalized) - reserved)
  }

  const selectedSkuShippableQty = useMemo(
    () => (skuInput.trim() ? getRemainingShippableQty(skuInput) : null),
    [skuInput, lines, stockSource, customerId, allProducts],
  )

  const updateLineQty = (lineId: string, rawQty: number) => {
    const qty = Math.max(1, Math.trunc(Number(rawQty) || 0))
    setLines(prev => prev.map(line => (line.id === lineId ? { ...line, qty } : line)))
  }

  useEffect(() => {
    if (!editOrder || hydratedEditId.current === editOrder.id) return
    hydratedEditId.current = editOrder.id
    setOutboundType(editOrder.type === 'dropship' ? '一件代发' : 'Takealot入仓')
    setPlatform(editOrder.type === 'takealot' ? 'Takealot' : PLATFORM_OPTIONS[0])
    setShippingMethod(editOrder.shippingMethod || LOGISTICS_CHANNELS[0])
    setRefNo(editOrder.refNo || '')
    setSellerStoreName(editOrder.sellerStoreName || '')
    setTakealotSellerId(editOrder.takealotSellerId || '')
    setTakealotBookingRef(editOrder.takealotBookingRef || '')
    setShipmentDueDate(editOrder.shipmentDueDate || '')
    setScheduledDeliveryDate(editOrder.scheduledDeliveryDate || '')
    setRemark(editOrder.remark || '')
    setTakealotDestWarehouse(editOrder.takealotDestWarehouse || DEFAULT_TAKEALOT_DEST_WAREHOUSE)
    destinationExplicitlySelected.current = Boolean(editOrder.takealotDestWarehouse)
    setDestRegion(editOrder.destRegion || 'jhb')
    setRecipientName(editOrder.recipient?.name || '')
    setRecipientProvince(editOrder.recipient?.province || '')
    setRecipientCity(editOrder.recipient?.city || '')
    setRecipientPostalCode(editOrder.recipient?.postalCode || '')
    setRecipientPhone(editOrder.recipient?.phone || '')
    setRecipientAddress1(editOrder.recipient?.address1 || '')
    setRecipientAddress2(editOrder.recipient?.address2 || '')
    setRecipientEmail(editOrder.recipient?.email || '')
    setAttachments(editOrder.attachments || [])
    setLines((editOrder.lineItems || []).map((line, index) => ({
      id: `${editOrder.id}-${index}`,
      sku: line.sku,
      name: line.name,
      qty: line.qty,
      declaredName: line.declaredName || '',
      declaredValue: line.declaredValue || 0,
      note: line.note || '',
      source: 'manual',
    })))
  }, [editOrder])

  useEffect(() => {
    if (isTakealot) return
    setTakealotParseHint('')
    setTakealotParsedDoc(null)
    setTakealotLabelResults({})
    setParseErrors([])
    takealotParsedParts.current.clear()
    setAttachments(prev => prev.filter(attachment => {
      if (attachment.labelRole === 'sourceDocument' || attachment.labelRole === 'unitCrop') return false
      if (attachment.fileType && takealotAttachmentKinds.has(attachment.fileType as TakealotAttachmentKind)) {
        return false
      }
      return true
    }))
  }, [isTakealot, takealotAttachmentKinds])

  useEffect(() => {
    if (activeDispatchRules.length === 0) return
    if (!dispatchRuleId || !activeDispatchRules.some(r => r.id === dispatchRuleId)) {
      setDispatchRuleId(activeDispatchRules[0].id)
    }
  }, [activeDispatchRules, dispatchRuleId])

  useEffect(() => {
    if (isTakealot) {
      const rule = findDispatchRuleForRegion(regionDispatchRules, effectiveDestRegion)
      if (rule && shippingMethod !== '自提') {
        setShippingMethod(rule.shippingMethod)
      }
      return
    }
    const rule = activeDispatchRules.find(r => r.id === dispatchRuleId)
    if (rule) {
      setDestRegion(rule.code)
      if (shippingMethod !== '自提') {
        setShippingMethod(rule.shippingMethod)
      }
    }
  }, [dispatchRuleId, isTakealot, effectiveDestRegion, takealotDestWarehouse, regionDispatchRules, activeDispatchRules])

  const applyDispatchRule = (ruleId: string) => {
    const rule = activeDispatchRules.find(r => r.id === ruleId)
    if (!rule) return
    setDispatchRuleId(ruleId)
    setDestRegion(rule.code)
    if (shippingMethod !== '自提') {
      setShippingMethod(rule.shippingMethod)
    }
  }

  const resolveDimensions = (sku: string) => {
    const prod = findProductByCode(sku)
    if (!prod) return undefined
    return {
      lengthCm: prod.lengthCm,
      widthCm: prod.widthCm,
      heightCm: prod.heightCm,
      weightKg: prod.weightKg,
    }
  }

  const feeEstimate = useMemo(() => {
    if (lines.length === 0) return null
    const stockLines = lines.map(l => ({ sku: l.sku, qty: l.qty }))
    return calculateOutboundPreDeduct(
      stockLines,
      shippingMethod,
      effectiveDestRegion,
      resolveDimensions,
      priceTemplate,
      regionDispatchRules,
    )
  }, [lines, shippingMethod, effectiveDestRegion, regionDispatchRules, priceTemplate])

  const goRecords = () => navigate('/outbound/records')

  const resetForm = () => {
    setTakealotDestWarehouse(DEFAULT_TAKEALOT_DEST_WAREHOUSE)
    setPlatform(PLATFORM_OPTIONS[0])
    setOutboundType('Takealot入仓')
    setShippingMethod(LOGISTICS_CHANNELS[0])
    setRefNo('')
    setSellerStoreName('')
    setTakealotSellerId('')
    setTakealotBookingRef('')
    setShipmentDueDate('')
    setScheduledDeliveryDate('')
    setTakealotParseHint('')
    setTakealotParsedDoc(null)
    setTakealotLabelResults({})
    setParseErrors([])
    setParseBusy(false)
    takealotParsedParts.current.clear()
    destinationExplicitlySelected.current = false
    setRemark('')
    setRecipientName('')
    setRecipientProvince('')
    setRecipientCity('')
    setRecipientPostalCode('')
    setRecipientPhone('')
    setRecipientAddress1('')
    setRecipientAddress2('')
    setRecipientEmail('')
    setAttachments([])
    setLines([])
    setSkuInput('')
    setQtyInput('')
    setDeclaredNameInput('')
    setDeclaredValueInput('')
    setNoteInput('')
    setDestRegion('jhb')
    setDispatchRuleId(activeDispatchRules[0]?.id ?? '')
    setQuickBindTarget(null)
  }

  const applyTakealotParsed = (doc: TakealotParsedDoc) => {
    if (doc.poNumber) setRefNo(doc.poNumber)
    if (doc.appointmentDate) setScheduledDeliveryDate(doc.appointmentDate)
    if (
      doc.warehouseCode
      && !(doc.warehouseConfidence === 'generic' && destinationExplicitlySelected.current)
    ) {
      const wh = doc.warehouseCode.toLowerCase()
      const exists = FULFILLMENT_WAREHOUSES.some(w => w.id === wh)
      if (exists) setTakealotDestWarehouse(wh)
    }
    if (doc.sellerName) setSellerStoreName(doc.sellerName)
    if (doc.sellerId) setTakealotSellerId(doc.sellerId)
    if (doc.bookingRef) setTakealotBookingRef(doc.bookingRef)
    if (doc.shipmentDate) setShipmentDueDate(doc.shipmentDate)
    setTakealotParseHint(describeTakealotParsed(doc))
    setTakealotParsedDoc(doc)
  }

  const labelCrops = useMemo(
    () => Object.values(takealotLabelResults).flatMap(result => result.crops),
    [takealotLabelResults],
  )

  const takealotValidationRows = useMemo<TakealotValidationRow[]>(() => {
    if (!takealotParsedDoc) return []
    const expected = new Map<string, { qty: number; title?: string }>()
    for (const item of takealotParsedDoc.lineItems) {
      const barcode = item.barcode || (/^\d{13}$/.test(item.sku) ? item.sku : '')
      if (!barcode || item.expectedQty == null) continue
      expected.set(barcode, {
        qty: item.expectedQty,
        title: item.productTitle,
      })
    }
    const observed = new Map<string, { qty: number; title?: string }>()
    for (const crop of labelCrops) {
      const current = observed.get(crop.barcode)
      observed.set(crop.barcode, {
        qty: (current?.qty || 0) + 1,
        title: current?.title || crop.title,
      })
    }
    const barcodes = [...new Set([...expected.keys(), ...observed.keys()])]
    const resolutions = new Map(
      resolvePlatformBarcodes(barcodes, {
        customerId: customerId ?? undefined,
        sellerId: effectiveTakealotSellerId,
        platform: 'Takealot',
      }).map(resolution => [resolution.barcode, resolution]),
    )

    return barcodes.map(barcode => {
      const expectedQty = expected.get(barcode)?.qty || 0
      const observedQty = observed.get(barcode)?.qty || 0
      const resolution = resolutions.get(barcode)
        ?? {
          barcode,
          status: 'unmatched' as const,
          mappings: [],
          reason: '未执行条码匹配',
        }
      const issues: string[] = []
      if (!isValidEan13(barcode)) issues.push('EAN-13 无效')
      if (observedQty < expectedQty) issues.push(`缺少 ${expectedQty - observedQty} 张标签`)
      if (observedQty > expectedQty) issues.push(`多出 ${observedQty - expectedQty} 张标签`)
      if (resolution.status === 'unmatched') issues.push('未绑定')
      if (resolution.status === 'ambiguous') issues.push('映射不唯一')
      return {
        barcode,
        title: expected.get(barcode)?.title || observed.get(barcode)?.title,
        expectedQty,
        observedQty,
        cropCount: observedQty,
        resolution,
        issues,
      }
    })
  }, [takealotParsedDoc, labelCrops, platformMappings, customerId, effectiveTakealotSellerId])

  useEffect(() => {
    if (!takealotParsedDoc) return
    const grouped = new Map<string, LineItem>()
    for (const row of takealotValidationRows) {
      if (row.expectedQty <= 0 || row.resolution.status !== 'resolved') continue
      const multiplier = row.resolution.mapping.lines[0]?.qty || 1
      const product = row.resolution.product
      const current = grouped.get(product.internalSku)
      if (current) {
        current.qty += row.expectedQty * multiplier
        continue
      }
      grouped.set(product.internalSku, {
        id: `takealot-${product.internalSku}`,
        sku: product.internalSku,
        name: product.name,
        qty: row.expectedQty * multiplier,
        declaredName: product.declaredNameEn || product.name,
        declaredValue: product.declaredValue || product.price || 0,
        note: `Takealot ${row.barcode}`,
        source: 'takealot',
      })
    }
    const mapped = [...grouped.values()]
    const mappedSkus = new Set(mapped.map(line => line.sku))
    setLines(previous => {
      const existingBySku = new Map(previous.map(line => [line.sku, line]))
      const merged = mapped.map(line => {
        const existing = existingBySku.get(line.sku)
        if (!existing) return line
        return {
          ...line,
          id: existing.id,
          qty: existing.qty,
          declaredName: existing.declaredName || line.declaredName,
          declaredValue: existing.declaredValue || line.declaredValue,
          note: existing.note || line.note,
          source: existing.source === 'manual' ? 'manual' : line.source,
        }
      })
      return [
        ...previous.filter(line => line.source !== 'takealot' && !mappedSkus.has(line.sku)),
        ...merged,
      ]
    })
  }, [takealotParsedDoc, takealotValidationRows])

  useEffect(() => {
    const skuByBarcode = new Map<string, string>()
    for (const row of takealotValidationRows) {
      if (row.resolution.status === 'resolved') {
        skuByBarcode.set(row.barcode, row.resolution.product.internalSku)
      }
    }
    setAttachments(previous => {
      let changed = false
      const next = previous.map(attachment => {
        if (attachment.labelRole !== 'unitCrop' || !attachment.platformBarcode) return attachment
        const sku = skuByBarcode.get(attachment.platformBarcode)
        if (attachment.sku === sku) return attachment
        changed = true
        return { ...attachment, sku }
      })
      return changed ? next : previous
    })
  }, [takealotValidationRows])

  const sourceAttachmentTypes = useMemo(
    () => new Set(
      attachments
        .filter(attachment => attachment.labelRole === 'sourceDocument')
        .map(attachment => attachment.fileType),
    ),
    [attachments],
  )
  const missingTakealotDocs = TAKEALOT_DOWNLOAD_ITEMS
    .filter(item => !sourceAttachmentTypes.has(item.fileType))
    .map(item => item.label)
  const labelBlockingStates = Object.values(takealotLabelResults)
    .flatMap(result => result.blockingStates)
  const parsedParts = [...takealotParsedParts.current.values()].flat()
  const identityConflicts = takealotParseConflicts(parsedParts)
  const takealotWarnings = takealotParsedDoc ? takealotParseWarnings(takealotParsedDoc) : []
  const expectedTotal = takealotValidationRows.reduce((sum, row) => sum + row.expectedQty, 0)
  const observedTotal = takealotValidationRows.reduce((sum, row) => sum + row.observedQty, 0)
  const takealotValidationBlockers = [
    ...missingTakealotDocs.map(label => `缺少${label}`),
    ...parseErrors,
    ...identityConflicts,
    ...labelBlockingStates.map(state => state.message),
    ...(takealotParsedDoc ? takealotMissingFields(takealotParsedDoc).map(field => `缺少${field}`) : ['尚未解析 Takealot 文件']),
    ...takealotValidationRows.flatMap(row => row.issues.map(issue => `${row.barcode}：${issue}`)),
    ...(takealotParsedDoc?.totalUnits != null && takealotParsedDoc.totalUnits !== expectedTotal
      ? [`预约单总件数 ${takealotParsedDoc.totalUnits} 与清单 ${expectedTotal} 不一致`]
      : []),
  ].filter((message, index, list) => list.indexOf(message) === index)

  const onPickGeneralAttachments = async (files: FileList | null) => {
    if (!files?.length) return
    const next: FileAttachment[] = []
    for (const file of Array.from(files)) {
      next.push(await fileToAttachment(file, 'outbound_doc'))
    }
    setAttachments(prev => [...prev, ...next])
  }

  const removeGeneralAttachment = (fileName: string) => {
    setAttachments(prev => prev.filter(attachment => attachment.fileName !== fileName))
  }

  const onPickAttachment = async (
    files: FileList | null,
    kind: TakealotAttachmentKind | 'auto',
  ) => {
    if (!files?.length) return
    const selected = Array.from(files)
    if (selected.length > 1) {
      setParseErrors(['请一次只上传一个文件。后传文件的 PO 号、Seller ID、目的仓等必须与已上传文件一致，否则将拒绝上传。'])
      return
    }
    setParseBusy(true)
    setParseErrors([])
    const next: FileAttachment[] = []
    const errors: string[] = []
    const partsByFile = new Map<string, Partial<TakealotParsedDoc>[]>()
    const uploadedTypes = new Set<TakealotAttachmentKind>()
    const nextLabelResults = { ...takealotLabelResults }
    const generatedLabelResults: Record<string, TakealotLabelPdfResult> = {}
    try {
      for (const file of selected) {
        const fromName = parseTakealotFilename(file.name)
        let text = ''
        if (file.name.toLowerCase().endsWith('.pdf')) {
          try {
            text = await extractPdfTextFromFile(file)
          } catch (error) {
            if (kind !== TAKEALOT_ATTACHMENT_KINDS.skuLabel) {
              errors.push(`${file.name}：PDF 文本读取失败，已尝试按文件名识别`)
            }
          }
        } else if (file.type.startsWith('text/') || /\.(txt|csv)$/i.test(file.name)) {
          text = await file.text()
        }
        const detectedKind = (
          kind === 'auto'
            ? detectTakealotDocKind(file.name, text)
            : FILE_TYPE_TO_DOC_KIND[kind]
        ) as TakealotDocKind
        const fileType = DOC_KIND_TO_FILE_TYPE[detectedKind]
        if (!fileType) {
          errors.push(`${file.name}：无法确定 Takealot 文件类型`)
          continue
        }
        uploadedTypes.add(fileType)
        const sourceAttachment = await fileToAttachment(file, fileType)
        next.push({
          ...sourceAttachment,
          kind: fileType,
          fileType,
          labelRole: 'sourceDocument',
        })
        let fromText: Partial<TakealotParsedDoc> = { sources: [], lineItems: [] }
        if (text.trim()) {
          fromText = parseTakealotDocumentText(text, detectedKind)
        } else if (
          file.name.toLowerCase().endsWith('.pdf')
          && fileType !== TAKEALOT_ATTACHMENT_KINDS.skuLabel
        ) {
          errors.push(`${file.name}：未提取到文字，扫描版 PDF 只能识别文件名`)
        }

        const fileParts: Partial<TakealotParsedDoc>[] = [fromName, fromText]
        if (
          fileType === TAKEALOT_ATTACHMENT_KINDS.skuLabel
          && file.name.toLowerCase().endsWith('.pdf')
        ) {
          try {
            const result = await parseTakealotProductLabelPdf(file)
            generatedLabelResults[file.name] = result
            const counts = new Map<string, { qty: number; title?: string }>()
            for (const crop of result.crops) {
              const current = counts.get(crop.barcode)
              counts.set(crop.barcode, {
                qty: (current?.qty || 0) + 1,
                title: current?.title || crop.title,
              })
              next.push({
                kind: TAKEALOT_ATTACHMENT_KINDS.skuLabel,
                fileType: TAKEALOT_ATTACHMENT_KINDS.skuLabel,
                fileName: crop.fileName,
                url: crop.dataUrl,
                uploadedAt: sourceAttachment.uploadedAt,
                platformBarcode: crop.barcode,
                unitIndex: crop.unitIndex,
                sourcePage: crop.page,
                sourceRow: crop.row + 1,
                sourceColumn: crop.column + 1,
                labelRole: 'unitCrop',
                localStorageRef: file.name,
              })
            }
            fileParts.push({
              sources: [`labels:${file.name}`],
              lineItems: [...counts.entries()].map(([barcode, value]) => ({
                sku: barcode,
                barcode,
                qty: value.qty,
                observedLabelCount: value.qty,
                productTitle: value.title,
              })),
            })
          } catch (error) {
            errors.push(`${file.name}：SKU 标签裁切失败：${error instanceof Error ? error.message : String(error)}`)
          }
        }
        partsByFile.set(`${fileType}:${file.name}`, fileParts)
      }
      if (!partsByFile.size) {
        setParseErrors(errors.length ? errors : [`${selected[0].name}：无法识别，已拒绝上传`])
        return
      }

      const incomingParts = [...partsByFile.values()].flat()
      const intraMismatches = takealotIdentityConflicts(incomingParts)
      if (intraMismatches.length) {
        setParseErrors([
          `${selected[0].name} 已拒绝上传：文件内字段不一致。${intraMismatches.join('；')}`,
        ])
        return
      }
      const existingParts = [...takealotParsedParts.current.entries()]
        .filter(([key]) => !uploadedTypes.has(key.split(':')[0] as TakealotAttachmentKind))
        .flatMap(([, parts]) => parts)
      const crossMismatches = takealotIdentityConflicts([...existingParts, ...incomingParts])
      if (crossMismatches.length) {
        setParseErrors([
          `${selected[0].name} 已拒绝上传：与已上传文件字段不一致。${crossMismatches.join('；')}`,
        ])
        return
      }

      if (kind === 'auto' || TAKEALOT_DOWNLOAD_ITEMS.some(item => item.fileType === kind)) {
        setOutboundType('Takealot入仓')
      }

      for (const fileType of uploadedTypes) {
        for (const key of takealotParsedParts.current.keys()) {
          if (key.startsWith(`${fileType}:`)) takealotParsedParts.current.delete(key)
        }
        if (fileType === TAKEALOT_ATTACHMENT_KINDS.skuLabel) {
          for (const name of Object.keys(nextLabelResults)) delete nextLabelResults[name]
        }
      }
      for (const [key, parts] of partsByFile) {
        takealotParsedParts.current.set(key, parts)
      }
      Object.assign(nextLabelResults, generatedLabelResults)

      const merged = mergeTakealotParsed(...[...takealotParsedParts.current.values()].flat())
      applyTakealotParsed(merged)
      setAttachments(prev => [
        ...prev.filter(existing =>
          !uploadedTypes.has(existing.fileType as TakealotAttachmentKind)
          && !next.some(item => item.fileName === existing.fileName)),
        ...next,
      ])
      setTakealotLabelResults(nextLabelResults)
      setParseErrors(errors)
    } finally {
      setParseBusy(false)
    }
  }

  const quickBindEditing = useMemo(() => {
    if (!quickBindTarget) return null
    const sellerStoreIds = new Set(
      findTakealotStoresForSeller(effectiveTakealotSellerId, customerId ?? undefined)
        .map(store => store.id),
    )
    const matches = platformMappings.filter(mapping =>
      mapping.platform === 'Takealot'
      && mapping.platformBarcode === quickBindTarget.barcode
      && (!customerId || !mapping.customerId || mapping.customerId === customerId)
      && (
        !effectiveTakealotSellerId
        || mapping.sellerId === effectiveTakealotSellerId
        || (!mapping.sellerId && sellerStoreIds.has(mapping.storeId))
      ))
    return matches.length === 1 ? matches[0] : null
  }, [quickBindTarget, platformMappings, customerId, effectiveTakealotSellerId])

  const openQuickBind = (row: TakealotValidationRow) => {
    if (!can('platform:write')) {
      const query = new URLSearchParams({
        tab: 'platform',
        barcode: row.barcode,
        title: row.title || '',
      })
      window.open(`/codes?${query.toString()}`, '_blank', 'noopener,noreferrer')
      return
    }
    setQuickBindTarget({ barcode: row.barcode, title: row.title })
  }

  const saveQuickBinding = async (
    form: BindingFormState,
    previous: PlatformSkuMapping | null,
  ) => {
    const validLines = form.lines.filter(line => line.internalSku)
    if (!form.platformBarcode.trim() || validLines.length !== 1) {
      window.alert('快速绑定需要填写平台条码并且只选择一个仓库 SKU')
      return
    }
    const store = stores.find(item => item.id === form.storeId) ?? quickBindStore
    const bindingSellerId = effectiveTakealotSellerId || store?.sellerId
    const before = platformMappings
    const now = todayDateInput()
    const next = previous
      ? platformMappings.map(mapping => mapping.id === previous.id ? {
          ...mapping,
          customerId: customerId ?? mapping.customerId,
          sellerId: bindingSellerId || mapping.sellerId,
          platform: form.platform,
          storeId: form.storeId,
          storeName: store?.name || mapping.storeName,
          platformSkuId: form.platformSkuId || previous.platformSkuId,
          platformBarcode: form.platformBarcode.trim(),
          platformTitle: form.platformTitle.trim(),
          lines: validLines,
          stockSource: form.stockSource,
          status: previous.hasInventory && previous.status === 'active'
            ? 'pending_review' as const
            : 'active' as const,
          syncSource: 'manual' as const,
          version: previous.version + 1,
          updatedAt: now,
        } : mapping)
      : [...platformMappings, {
          id: `pb-${Date.now()}`,
          customerId: customerId ?? undefined,
          sellerId: bindingSellerId,
          platform: form.platform,
          storeId: form.storeId,
          storeName: store?.name || '—',
          platformSkuId: form.platformSkuId || undefined,
          platformBarcode: form.platformBarcode.trim(),
          platformTitle: form.platformTitle.trim(),
          lines: validLines,
          status: 'active' as const,
          stockSource: form.stockSource,
          syncSource: 'manual' as const,
          version: 1,
          hasInventory: false,
          updatedAt: now,
        }]
    setPlatformSkuMappings(next)
    try {
      await apiPut('/platform-sku-mappings', next)
      setQuickBindTarget(null)
    } catch (error) {
      setPlatformSkuMappings(before)
      window.alert(`绑定保存失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleSubmit = async (asDraft = false) => {
    const submitCustomerId = getCustomerIdForRole(role) ?? undefined
    const type: OutboundType = isTakealot ? 'takealot' : 'dropship'
    const source: ShipmentSource = role === 'catalog' ? 'catalog_dist' : 'platform_order'
    const stockSource: StockSource = role === 'catalog' ? 'catalog' : 'owned'
    const totalQty = lines.reduce((s, l) => s + l.qty, 0)
    const destination = isTakealot
      ? warehouseLabel(takealotDestWarehouse)
      : [recipientAddress1.trim(), recipientCity.trim(), recipientProvince.trim(), recipientPostalCode.trim()]
          .filter(Boolean)
          .join(', ')

    const stockLines = lines.length > 0
      ? lines.map(l => ({ sku: l.sku, qty: l.qty }))
      : []

    if (!asDraft && isTakealot && takealotValidationBlockers.length > 0) {
      window.alert(
        `Takealot 文件校验未通过：\n${takealotValidationBlockers.slice(0, 10).join('\n')}${takealotValidationBlockers.length > 10 ? `\n…另有 ${takealotValidationBlockers.length - 10} 项` : ''}`,
      )
      return
    }
    if (!asDraft && stockLines.length === 0) {
      window.alert('请先添加出库货品')
      return
    }
    if (!asDraft && !scheduledDeliveryDate) {
      window.alert('请填写预约送仓时间')
      return
    }
    if (
      !asDraft &&
      isDropship &&
      (!recipientName.trim() ||
        !recipientCity.trim() ||
        !recipientPostalCode.trim() ||
        !recipientPhone.trim() ||
        !recipientAddress1.trim())
    ) {
      window.alert('请完整填写收件人姓名、城市、邮编、电话和地址1')
      return
    }

    const outboundNo = editOrder?.outboundNo || nextOutboundNo()
    const submitPriceTemplate = getPriceTemplateForCustomer(submitCustomerId, effectiveDestRegion)
    const feeResult = asDraft
      ? { lines: [], total: 0, totalVolumeM3: 0, totalWeightKg: 0 }
      : calculateOutboundPreDeduct(
          stockLines,
          shippingMethod,
          effectiveDestRegion,
          resolveDimensions,
          submitPriceTemplate,
          regionDispatchRules,
        )

    const localOrder: OutboundOrder = {
      id: editOrder?.id || String(Date.now()),
      customerId: submitCustomerId,
      outboundNo,
      source,
      stockSource,
      refNo: refNo.trim() || undefined,
      type,
      warehouse: SHIP_WAREHOUSE_ID,
      items: lines.length,
      totalQty,
      status: asDraft ? 'draft' : 'locked',
      destination: destination || '待完善',
      recipient: isDropship ? {
        name: recipientName.trim(),
        province: recipientProvince.trim() || undefined,
        city: recipientCity.trim(),
        postalCode: recipientPostalCode.trim(),
        phone: recipientPhone.trim(),
        address1: recipientAddress1.trim(),
        address2: recipientAddress2.trim() || undefined,
        email: recipientEmail.trim() || undefined,
      } : undefined,
      createdAt: editOrder?.createdAt || todayDateInput(),
      shippingMethod,
      preDeductFees: feeResult.lines.map(f => ({ type: f.type, amount: f.amount, label: f.label, detail: f.detail })),
      destRegion: effectiveDestRegion,
      priceTemplateId: submitPriceTemplate.id,
      priceTemplateName: submitPriceTemplate.name,
      preDeductTotal: feeResult.total,
      preDeductVolumeM3: feeResult.totalVolumeM3,
      preDeductWeightKg: feeResult.totalWeightKg,
      settlementStatus: feeResult.total > 0 ? 'pending' as const : undefined,
      scheduledDeliveryDate,
      sellerStoreName: sellerStoreName.trim() || undefined,
      takealotDestWarehouse,
      takealotSellerId: takealotSellerId.trim() || undefined,
      takealotBookingRef: takealotBookingRef.trim() || undefined,
      shipmentDueDate: shipmentDueDate || undefined,
      takealotLabelValidation: isTakealot ? {
        expectedQty: expectedTotal,
        observedQty: observedTotal,
        cropCount: labelCrops.length,
        blockingCount: takealotValidationBlockers.length,
      } : undefined,
      remark: remark.trim() || undefined,
      lineItems: lines.map(l => ({
        sku: l.sku,
        name: l.name,
        qty: l.qty,
        declaredName: l.declaredName || undefined,
        declaredValue: l.declaredValue || undefined,
        note: l.note || undefined,
      })),
      attachments: attachments.length ? attachments : undefined,
    }

    if (asDraft) {
      try {
        await addOutboundOrderOrThrow(localOrder)
        window.alert(`草稿已保存：${outboundNo}`)
        resetForm()
        goRecords()
      } catch (error) {
        window.alert(`草稿保存失败：${error instanceof Error ? error.message : String(error)}`)
      }
      return
    }

    if (!window.confirm(`确认提交出库单？将锁定 ${totalQty} 件库存并预扣 ${formatCurrency(feeResult.total)}。`)) {
      return
    }

    const lockResult = await lockStockForOutbound(stockLines, stockSource, submitCustomerId)
    if (!lockResult.ok) {
      window.alert(lockResult.error)
      return
    }

    const deductResult = await preDeductOutboundFees(
      outboundNo,
      feeResult.lines,
      submitCustomerId ? getCustomerCode(submitCustomerId) : undefined,
    )
    if (!deductResult.ok) {
      try {
        await rollbackStockForOutbound(stockLines, stockSource, submitCustomerId)
      } catch (rollbackError) {
        window.alert(`${deductResult.error}\n库存回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
        return
      }
      window.alert(deductResult.error)
      return
    }

    try {
      await addOutboundOrderOrThrow(localOrder)
    } catch (error) {
      await Promise.allSettled([
        rollbackPreDeductOutboundFees(outboundNo),
        rollbackStockForOutbound(stockLines, stockSource, submitCustomerId),
      ])
      window.alert(`出库单保存失败，已回滚库存和预扣：${error instanceof Error ? error.message : String(error)}`)
      return
    }

    const erpResult = await submitOutboundToErp(localOrder)
    if (!erpResult.ok) {
      const rollbackResults = await Promise.allSettled([
        rollbackPreDeductOutboundFees(outboundNo),
        rollbackStockForOutbound(stockLines, stockSource, submitCustomerId),
      ])
      const removeResult = await Promise.allSettled([removeOutboundOrder(localOrder.id)])
      const rollbackFailed = rollbackResults.some(result => result.status === 'rejected')
        || removeResult.some(result => result.status === 'rejected')
      window.alert(
        rollbackFailed
          ? `同步 ERP 失败；本地回滚未完全保存，请联系管理员：${erpResult.error}`
          : `同步 ERP 失败，已回滚本地预扣与库存：${erpResult.error}`,
      )
      return
    }

    resetForm()
    goRecords()
  }

  const addLine = () => {
    if (!skuInput || !qtyInput) return
    const sku = resolveLineSku(skuInput)
    const prod = findProductByCode(skuInput)
    const qty = Math.max(1, Math.trunc(Number(qtyInput) || 0))
    const declaredValue = declaredValueInput ? Number(declaredValueInput) : (prod?.price ?? 0)
    setLines(prev => [...prev, {
      id: String(Date.now()),
      sku,
      name: prod?.name ?? sku,
      qty,
      declaredName: declaredNameInput || prod?.declaredNameEn || sku,
      declaredValue: Number.isFinite(declaredValue) ? declaredValue : 0,
      note: noteInput,
      source: 'manual',
    }])
    setSkuInput('')
    setQtyInput('')
    setDeclaredNameInput('')
    setDeclaredValueInput('')
    setNoteInput('')
  }

  const handleBatchUploadLines = async () => {
    try {
      const { data, errors } = await importCsvFile(OUTBOUND_LINE_COLUMNS, parseOutboundLines)
      if (errors.length > 0) {
        window.alert(`导入失败：\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? `\n…共 ${errors.length} 条` : ''}`)
        return
      }
      if (data.length === 0) {
        window.alert('未解析到有效明细，请使用最新模板')
        return
      }
      setLines(prev => [...prev, ...data.map(row => ({
        ...row,
        sku: resolveLineSku(row.sku),
        declaredName: row.declaredName ?? row.name,
        declaredValue: row.declaredValue ?? 0,
        note: row.note ?? '',
        source: 'manual' as const,
      }))])
      window.alert(`已导入 ${data.length} 行出库明细`)
    } catch (err) {
      notifyIfUserError(err, '导入失败')
    }
  }

  const availableProducts = allProducts.filter(p => catalogOnly ? p.inCatalog : true)
  const parseMissing = takealotParsedDoc ? takealotMissingFields(takealotParsedDoc) : []
  const parsedFieldCount = takealotParsedDoc ? 7 - parseMissing.length : 0

  return (
    <div className="page-shell pb-24">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-primary-600">OutWhBill · 预约发货</p>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">预约发货</h1>
          <p className="mt-1 text-sm text-text-secondary">参考易仓出库单模板填写，提交后锁定库存并由海外仓执行出库</p>
        </div>
        <Link to="/outbound/records" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium text-text-secondary hover:bg-surface-muted">
          <ListOrdered className="h-3.5 w-3.5" /> 查看出库记录
        </Link>
      </div>

      {!isTakealot && (
      <Card className="mb-4 overflow-hidden border-primary-200">
        <div className="border-b border-border-light px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-600">先上传，再填单</p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-text-primary">附件上传</h2>
              <p className="mt-1 text-xs text-text-muted">
                上传面单、装箱清单等出库相关文件（可选，支持多文件）
              </p>
            </div>
            {attachments.length > 0 && (
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-100">
                已上传 {attachments.length} 个文件
              </span>
            )}
          </div>
        </div>

        <div className="p-5">
          <input
            ref={generalAttachmentRef}
            type="file"
            multiple
            className="hidden"
            onChange={e => {
              void onPickGeneralAttachments(e.target.files)
              e.currentTarget.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => generalAttachmentRef.current?.click()}
            className="w-full rounded-xl border-2 border-dashed border-border px-5 py-6 text-center transition-colors hover:border-primary-300 hover:bg-surface-muted/40"
          >
            <Upload className="mx-auto h-6 w-6 text-primary-500" />
            <p className="mt-2 text-sm font-semibold text-text-primary">点击选择或拖入文件</p>
            <p className="mt-1 text-[11px] text-text-muted">支持 PDF、图片、Excel 等常见格式，可多选</p>
          </button>

          {attachments.length > 0 && (
            <ul className="mt-4 space-y-2">
              {attachments.map(attachment => (
                <li
                  key={`${attachment.fileName}-${attachment.uploadedAt}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border-light bg-surface-muted/30 px-3 py-2"
                >
                  <span className="truncate text-xs text-text-secondary">{attachment.fileName}</span>
                  <button
                    type="button"
                    onClick={() => removeGeneralAttachment(attachment.fileName)}
                    className="shrink-0 text-red-500 hover:text-red-700"
                    aria-label={`删除 ${attachment.fileName}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      )}

      {isTakealot && (
      <Card className="mb-4 overflow-hidden border-primary-200">
        <div className="border-b border-border-light px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-600">先上传，再填单</p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-text-primary">Takealot 文件智能识别</h2>
              <p className="mt-1 text-xs text-text-muted">
                请逐个上传预约单、发货清单、SKU 标签和外箱标。后传文件的 PO 号、Seller ID、目的仓等必须与已上传文件一致，否则将拒绝上传。
              </p>
            </div>
            {takealotParsedDoc && (
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-100">
                已识别 {parsedFieldCount}/7 类字段
              </span>
            )}
          </div>
        </div>

        <div className="p-5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.csv,application/pdf,text/plain,text/csv"
            className="hidden"
            onChange={e => {
              void onPickAttachment(e.target.files, 'auto')
              e.currentTarget.value = ''
            }}
          />
          <button
            type="button"
            disabled={parseBusy}
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={e => {
              e.preventDefault()
              setDraggingFiles(true)
            }}
            onDragOver={e => e.preventDefault()}
            onDragLeave={() => setDraggingFiles(false)}
            onDrop={e => {
              e.preventDefault()
              setDraggingFiles(false)
              void onPickAttachment(e.dataTransfer.files, 'auto')
            }}
            className={`w-full rounded-xl border-2 border-dashed px-5 py-6 text-center transition-colors ${
              draggingFiles ? 'border-primary-500 bg-primary-50' : 'border-primary-200 bg-primary-50/30 hover:border-primary-400'
            }`}
          >
            <Upload className="mx-auto h-6 w-6 text-primary-500" />
            <p className="mt-2 text-sm font-semibold text-text-primary">
              {parseBusy ? '正在读取并识别文件…' : '点击选择或拖入 Takealot 文件'}
            </p>
            <p className="mt-1 text-[11px] text-text-muted">一次只能上传一个 PDF；请按文件逐个添加</p>
          </button>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TAKEALOT_DOWNLOAD_ITEMS.map(item => {
              const uploaded = attachments.filter(attachment =>
                attachment.fileType === item.fileType
                && attachment.labelRole === 'sourceDocument')
              return (
                <div key={item.fileType}>
                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    className="hidden"
                    ref={element => { takealotFileRefs.current[item.fileType] = element }}
                    onChange={e => {
                      void onPickAttachment(e.target.files, item.fileType)
                      e.currentTarget.value = ''
                    }}
                  />
                  <button
                    type="button"
                    disabled={parseBusy}
                    onClick={() => takealotFileRefs.current[item.fileType]?.click()}
                    className="w-full rounded-lg border border-border-light bg-surface-muted/40 px-3 py-2.5 text-left hover:border-primary-300 hover:bg-primary-50/30"
                  >
                    <p className="text-xs font-medium text-text-secondary">{item.label}</p>
                    <p className={`mt-0.5 text-[10px] ${uploaded.length ? 'text-emerald-700' : 'text-text-muted'}`}>
                      {uploaded.length ? `${uploaded.length} 个文件` : '一次上传一个'}
                    </p>
                  </button>
                </div>
              )
            })}
          </div>

          {takealotParseHint && (
            <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-3 ring-1 ring-emerald-100">
              <p className="text-xs font-medium text-emerald-800">已自动填写：{takealotParseHint}</p>
              {parseMissing.length > 0 && (
                <p className="mt-1 text-[11px] text-amber-700">仍需补充：{parseMissing.join('、')}</p>
              )}
            </div>
          )}
          {parseErrors.length > 0 && (
            <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-800 ring-1 ring-red-100">
              {parseErrors.map(error => <p key={error}>{error}</p>)}
            </div>
          )}
          {takealotParsedDoc && (
            <div className="mt-4 overflow-hidden rounded-xl border border-border-light bg-white">
              <div className={`border-b px-4 py-3 ${
                takealotValidationBlockers.length
                  ? 'border-red-100 bg-red-50/70'
                  : 'border-emerald-100 bg-emerald-50/70'
              }`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {takealotValidationBlockers.length
                      ? <XCircle className="h-4 w-4 text-red-600" />
                      : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                    <div>
                      <p className="text-xs font-semibold text-text-primary">Takealot 提交校验</p>
                      <p className="text-[10px] text-text-muted">
                        {takealotValidationBlockers.length
                          ? `${takealotValidationBlockers.length} 项阻塞，修复后才能提交`
                          : '四份文件、数量、条码映射与裁切均已通过'}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-4 font-mono text-[11px] text-text-secondary">
                    <span>清单 {expectedTotal}</span>
                    <span>标签 {observedTotal}</span>
                    <span>裁切 {labelCrops.length}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 border-b border-border-light sm:grid-cols-4">
                {TAKEALOT_DOWNLOAD_ITEMS.map(item => {
                  const uploaded = sourceAttachmentTypes.has(item.fileType)
                  return (
                    <div key={item.fileType} className="flex items-center gap-1.5 border-r border-border-light px-3 py-2 text-[10px] last:border-r-0">
                      {uploaded
                        ? <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                        : <XCircle className="h-3 w-3 text-red-500" />}
                      <span className={uploaded ? 'text-text-secondary' : 'text-red-700'}>{item.label}</span>
                    </div>
                  )
                })}
              </div>

              {takealotWarnings.length > 0 && (
                <div className="border-b border-amber-100 bg-amber-50 px-4 py-2">
                  {takealotWarnings.map(warning => (
                    <p key={warning} className="flex items-center gap-1.5 text-[10px] text-amber-800">
                      <AlertTriangle className="h-3 w-3" /> {warning}（仅提醒，不阻塞提交）
                    </p>
                  ))}
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-[11px]">
                  <thead className="bg-surface-muted/60 text-text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">平台条码</th>
                      <th className="px-3 py-2 font-medium">产品</th>
                      <th className="px-3 py-2 text-center font-medium">清单</th>
                      <th className="px-3 py-2 text-center font-medium">标签</th>
                      <th className="px-3 py-2 text-center font-medium">裁切</th>
                      <th className="px-3 py-2 font-medium">仓库 SKU</th>
                      <th className="px-3 py-2 font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {takealotValidationRows.map(row => (
                      <tr key={row.barcode}>
                        <td className="px-3 py-2 font-mono text-text-primary">{row.barcode}</td>
                        <td className="max-w-[220px] truncate px-3 py-2 text-text-secondary" title={row.title}>{row.title || '—'}</td>
                        <td className="px-3 py-2 text-center font-semibold">{row.expectedQty}</td>
                        <td className={`px-3 py-2 text-center font-semibold ${row.expectedQty === row.observedQty ? 'text-emerald-700' : 'text-red-700'}`}>{row.observedQty}</td>
                        <td className="px-3 py-2 text-center">{row.cropCount}</td>
                        <td className="px-3 py-2">
                          {row.resolution.status === 'resolved'
                            ? <MonoCode>{row.resolution.product.internalSku}</MonoCode>
                            : <span className="text-text-muted">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          {row.issues.length === 0 ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" /> 通过
                            </span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-red-700">{row.issues.join('、')}</span>
                              {row.resolution.status === 'unmatched' && (
                                <button
                                  type="button"
                                  onClick={() => openQuickBind(row)}
                                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary-50 px-2 py-1 font-medium text-primary-700 hover:bg-primary-100"
                                >
                                  <Link2 className="h-3 w-3" /> 快速绑定
                                </button>
                              )}
                              {row.resolution.status === 'ambiguous' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const query = new URLSearchParams({ tab: 'platform', barcode: row.barcode, title: row.title || '' })
                                    window.open(`/codes?${query.toString()}`, '_blank', 'noopener,noreferrer')
                                  }}
                                  className="shrink-0 font-medium text-primary-700 hover:underline"
                                >
                                  处理冲突
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {takealotValidationRows.length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-6 text-center text-text-muted">尚未解析到清单条码或产品标签</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {takealotValidationBlockers.length > 0 && (
                <div className="border-t border-red-100 bg-red-50/50 px-4 py-2 text-[10px] text-red-800">
                  {takealotValidationBlockers.slice(0, 6).map(blocker => <p key={blocker}>• {blocker}</p>)}
                  {takealotValidationBlockers.length > 6 && <p>• 另有 {takealotValidationBlockers.length - 6} 项</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
      )}

      <div className="space-y-4">
        <FormSection num={1} title="出库信息">
          <FormGrid cols={3}>
            <FormField label="发货仓库" required>
              <select value={SHIP_WAREHOUSE_ID} className={formSelect()} disabled>
                <option value={SHIP_WAREHOUSE_ID}>{SHIP_WAREHOUSE_ID}</option>
              </select>
            </FormField>
            <FormField label="出库类型" required>
              <select
                className={formSelect()}
                value={outboundType}
                onChange={e => setOutboundType(e.target.value)}
              >
                {OUTBOUND_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </FormField>
            <FormField label="配送方式" required hint="自提仅收操作费；其余按地区模板默认">
              <select value={shippingMethod} onChange={e => setShippingMethod(e.target.value)} className={formSelect()}>
                {LOGISTICS_CHANNELS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </FormField>
            <FormField label="出库单号" hint="提交后由系统自动生成">
              <input className={formInput()} value="提交后自动生成" readOnly disabled />
            </FormField>
            <FormField label="参考号" hint="客户自行填写，用于对账（PO 号、内部单号等）">
              <input
                value={refNo}
                onChange={e => setRefNo(e.target.value)}
                className={formInput()}
                placeholder="选填，如 PO-20260706"
              />
            </FormField>
            <FormField label="平台">
              <select
                value={isTakealot ? 'Takealot' : platform}
                onChange={e => setPlatform(e.target.value)}
                className={formSelect()}
                disabled={isTakealot}
              >
                {PLATFORM_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </FormField>
            {isTakealot && (
              <>
                <FormField label="Takealot 目的仓" required>
                  <select
                    value={takealotDestWarehouse}
                    onChange={e => {
                      destinationExplicitlySelected.current = true
                      setTakealotDestWarehouse(e.target.value)
                    }}
                    className={formSelect()}
                  >
                    {FULFILLMENT_WAREHOUSES.map(w => (
                      <option key={w.id} value={w.id}>{warehouseLabel(w.id)}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="地区模板" hint="根据 Takealot 目的仓自动匹配">
                  <input
                    className={formInput()}
                    value={regionDispatchLabel(
                      findDispatchRuleForRegion(regionDispatchRules, effectiveDestRegion)
                      ?? { id: '', code: effectiveDestRegion, label: regionLabel(effectiveDestRegion, regionDispatchRules), shippingMethod: '卡派', enabled: true },
                    )}
                    readOnly
                    disabled
                  />
                </FormField>
                <FormField label="PO单号" hint="Takealot 入仓 PO，上传文件后可自动识别">
                  <input className={formInput()} placeholder="PO单号" value={refNo} onChange={e => setRefNo(e.target.value)} />
                </FormField>
                <FormField label="店铺名称" hint="上传清单/预约单后可自动识别">
                  <input className={formInput()} placeholder="Seller / 店铺名" value={sellerStoreName} onChange={e => setSellerStoreName(e.target.value)} />
                </FormField>
                <FormField label="Seller ID">
                  <input className={formInput()} placeholder="29896140" value={takealotSellerId} onChange={e => setTakealotSellerId(e.target.value)} />
                </FormField>
                <FormField label="Booking Reference" hint="预约单自动识别">
                  <input className={formInput()} placeholder="TAL..." value={takealotBookingRef} onChange={e => setTakealotBookingRef(e.target.value)} />
                </FormField>
                <FormField label="Shipment Due Date" hint="发货清单自动识别">
                  <input type="date" className={formInput()} value={shipmentDueDate} onChange={e => setShipmentDueDate(e.target.value)} />
                </FormField>
              </>
            )}
            {!isTakealot && (
              <>
                <FormField label="发货地区" required hint="选择发往哪里，自动套用卡派/快递">
                  <select
                    value={dispatchRuleId}
                    onChange={e => applyDispatchRule(e.target.value)}
                    className={formSelect()}
                  >
                    {activeDispatchRules.map(r => (
                      <option key={r.id} value={r.id}>{regionDispatchLabel(r)}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="参考号">
                  <input className={formInput()} placeholder="客户参考号" value={refNo} onChange={e => setRefNo(e.target.value)} />
                </FormField>
              </>
            )}
            <FormField label="预约送仓时间" required hint="上传预约单后可自动识别日期与时间">
              <input
                type="datetime-local"
                className={formInput()}
                value={scheduledDeliveryDate}
                onChange={e => setScheduledDeliveryDate(e.target.value)}
              />
            </FormField>
            <FormField label="订单件数">
              <input type="number" className={formInput()} value={lines.reduce((s, l) => s + l.qty, 0) || ''} readOnly />
            </FormField>
          </FormGrid>
          <div className="mt-4">
            <FormField label="订单备注">
              <textarea
                className={formTextarea()}
                placeholder="特殊处理说明、贴标要求等"
                value={remark}
                onChange={e => setRemark(e.target.value)}
              />
            </FormField>
          </div>
        </FormSection>

        {isDropship && (
          <FormSection num={2} title="收件人信息">
            <FormGrid cols={3}>
              <FormField label="收件人姓名" required>
                <input className={formInput()} placeholder="Consignee Name" value={recipientName} onChange={e => setRecipientName(e.target.value)} />
              </FormField>
              <FormField label="省/州">
                <input className={formInput()} placeholder="Province / State" value={recipientProvince} onChange={e => setRecipientProvince(e.target.value)} />
              </FormField>
              <FormField label="城市" required>
                <input className={formInput()} placeholder="City" value={recipientCity} onChange={e => setRecipientCity(e.target.value)} />
              </FormField>
              <FormField label="邮编" required>
                <input className={formInput()} placeholder="Postal Code" value={recipientPostalCode} onChange={e => setRecipientPostalCode(e.target.value)} />
              </FormField>
              <FormField label="电话" required>
                <input className={formInput()} placeholder="+27 ..." value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)} />
              </FormField>
              <FormField label="地址1" required className="sm:col-span-2 lg:col-span-3">
                <input className={formInput()} placeholder="Street Address Line 1" value={recipientAddress1} onChange={e => setRecipientAddress1(e.target.value)} />
              </FormField>
              <FormField label="地址2" className="sm:col-span-2 lg:col-span-3">
                <input className={formInput()} placeholder="Street Address Line 2 (optional)" value={recipientAddress2} onChange={e => setRecipientAddress2(e.target.value)} />
              </FormField>
              <FormField label="邮箱">
                <input type="email" className={formInput()} placeholder="email@example.com" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} />
              </FormField>
            </FormGrid>
          </FormSection>
        )}

        <FormSection
          num={isDropship ? 3 : 2}
          title="货品选择"
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={downloadOutboundLineTemplate}>下载模板</Button>
              <Button variant="secondary" size="sm" onClick={() => void handleBatchUploadLines()}>
                <Upload className="h-3.5 w-3.5" /> 批量上传
              </Button>
            </div>
          }
        >
          <ImportTemplateLegend columns={OUTBOUND_LINE_COLUMNS} />
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <FormField label="SKU" required>
              <SkuFuzzyPicker
                value={skuInput}
                onChange={setSkuInput}
                customerId={getCustomerIdForRole(role) ?? undefined}
                onSelect={product => {
                  setDeclaredNameInput(product.declaredNameEn || product.name)
                  setDeclaredValueInput(String(product.declaredValue || product.price || ''))
                }}
              />
            </FormField>
            <FormField
              label="数量"
              required
              hint={
                selectedSkuShippableQty != null
                  ? `仓库可发 ${selectedSkuShippableQty.toLocaleString()} 件${stockSource === 'catalog' ? '（已锁定库存）' : ''}`
                  : '> 0'
              }
            >
              <input value={qtyInput} onChange={e => setQtyInput(e.target.value)} type="number" min={1} className={formInput()} />
            </FormField>
            <FormField label="申报品名">
              <input
                className={formInput()}
                placeholder="Declared Name (EN)"
                value={declaredNameInput}
                onChange={e => setDeclaredNameInput(e.target.value)}
              />
            </FormField>
            <FormField label="申报价值">
              <input
                type="number"
                className={formInput()}
                placeholder="0.00"
                step="0.01"
                value={declaredValueInput}
                onChange={e => setDeclaredValueInput(e.target.value)}
              />
            </FormField>
            <div className="flex items-end gap-2">
              <Button size="sm" onClick={addLine}><Plus className="h-3.5 w-3.5" /> 增加</Button>
              <Button variant="secondary" size="sm" onClick={() => setLines([])}>清除</Button>
            </div>
          </div>

          <Card className="overflow-hidden">
            <Table>
              <thead className="table-head">
                <tr>
                  <th>SKU</th>
                  <th>产品标题</th>
                  <th>数量</th>
                  <th>申报品名</th>
                  <th>申报价值</th>
                  <th>备注</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody className="table-body">
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="table-cell py-8 text-center text-xs text-text-muted">
                      暂无货品，请录入 SKU 后点击「增加」，或使用批量上传
                      {availableProducts.length > 0 && (
                        <span className="mt-2 block text-[10px]">
                          可匹配库存：{availableProducts.slice(0, 3).map(p => p.internalSku).join('、')} 等
                        </span>
                      )}
                    </td>
                  </tr>
                ) : lines.map(row => {
                  const maxQty = getRemainingShippableQty(row.sku, row.id)
                  const overMax = row.qty > maxQty
                  return (
                  <tr key={row.id} className="table-row">
                    <td className="table-cell"><MonoCode>{row.sku}</MonoCode></td>
                    <td className="table-cell text-xs">{row.name}</td>
                    <td className="table-cell align-top">
                      <input
                        type="number"
                        min={1}
                        value={row.qty}
                        onChange={e => updateLineQty(row.id, Number(e.target.value))}
                        className={formInput('w-24 py-1 text-xs')}
                      />
                      <p className={`mt-1 text-[10px] ${overMax ? 'text-amber-700' : 'text-text-muted'}`}>
                        仓库可发 {maxQty.toLocaleString()} 件
                        {overMax ? ' · 已超出' : ''}
                      </p>
                    </td>
                    <td className="table-cell text-xs">{row.declaredName}</td>
                    <td className="table-cell text-xs">{row.declaredValue > 0 ? formatCurrency(row.declaredValue) : '—'}</td>
                    <td className="table-cell text-xs text-text-muted">{row.note || '—'}</td>
                    <td className="table-cell">
                      <button
                        type="button"
                        onClick={() => setLines(prev => prev.filter(l => l.id !== row.id))}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </Table>
          </Card>
          {lines.length > 0 && (
            <p className="mt-2 text-xs text-text-muted">
              合计 {lines.length} 行 · {lines.reduce((s, l) => s + l.qty, 0)} 件
            </p>
          )}
          <p className="mt-2 text-[11px] text-text-muted">提交后海外仓将执行打包发货，物流单号与签收单在「订单与出库」中查看</p>
        </FormSection>

        {feeEstimate && (
          <FormSection num={isDropship ? 4 : 3} title="费用试算 · 预扣款">
            <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-100">
              <p className="text-xs font-semibold text-amber-900">
                按 {effectiveDestRegion.toUpperCase()} 价格模板「{priceTemplate.name}」试算 · 提交时从余额预扣
              </p>
              <p className="mt-1 text-[11px] text-amber-800">
                {feeEstimate.pickupOnly
                  ? `自提 · ${regionLabel(feeEstimate.destRegion, regionDispatchRules)} · 操作费 + 自提费 · 体积 ${feeEstimate.totalVolumeM3.toFixed(4)} m³ · 重量 ${feeEstimate.totalWeightKg.toFixed(2)} kg`
                  : `${regionLabel(feeEstimate.destRegion, regionDispatchRules)} · 体积 ${feeEstimate.totalVolumeM3.toFixed(4)} m³ · 重量 ${feeEstimate.totalWeightKg.toFixed(2)} kg（依据 SKU 长宽高）`}
              </p>
              <ul className="mt-3 space-y-2">
                {feeEstimate.lines.map(f => (
                  <li key={f.type} className="flex items-start justify-between gap-3 text-xs">
                    <div>
                      <p className="font-medium text-text-primary">{f.label}</p>
                      <p className="text-[10px] text-text-muted">{f.detail}</p>
                    </div>
                    <span className="shrink-0 font-semibold text-amber-900">{formatCurrency(f.amount)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center justify-between border-t border-amber-200/60 pt-3">
                <span className="text-xs font-semibold text-amber-900">预扣合计</span>
                <span className="text-sm font-bold text-amber-900">{formatCurrency(feeEstimate.total)}</span>
              </div>
              <p className="mt-2 text-[10px] text-amber-700">
                当前余额 {formatCurrency(creditBalance)}
                {creditBalance < feeEstimate.total && ' · 余额不足，请先充值'}
              </p>
            </div>
          </FormSection>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border-light bg-white/95 px-6 py-4 backdrop-blur-sm lg:pl-[220px]">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-3">
          <p className="hidden text-xs text-text-muted sm:block">
            {feeEstimate
              ? `提交将预扣 ${formatCurrency(feeEstimate.total)} · 锁定库存并进入拣货`
              : '提交后锁定库存并进入拣货，可在出库记录跟踪进度'}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={goRecords}>取消</Button>
            <Button variant="secondary" onClick={() => void handleSubmit(true)}>保存草稿</Button>
            <Button
              disabled={isTakealot && takealotValidationBlockers.length > 0}
              title={isTakealot && takealotValidationBlockers.length ? '请先修复 Takealot 文件校验阻塞项' : undefined}
              onClick={() => void handleSubmit(false)}
            >
              提交并锁定库存
            </Button>
          </div>
        </div>
      </div>

      <PlatformBindingModal
        open={Boolean(quickBindTarget)}
        editing={quickBindEditing}
        customerId={customerId ?? undefined}
        initialValues={{
          platform: 'Takealot',
          storeId: quickBindStore?.id,
          platformBarcode: quickBindTarget?.barcode || '',
          platformTitle: quickBindTarget?.title || '',
          stockSource: role === 'catalog' ? 'catalog' : 'owned',
        }}
        onClose={() => setQuickBindTarget(null)}
        onSave={(form, previous) => void saveQuickBinding(form, previous)}
      />
    </div>
  )
}
