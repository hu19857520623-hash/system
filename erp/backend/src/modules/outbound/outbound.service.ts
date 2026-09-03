import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { FileStoreService } from '../../common/file-store.service'
import { OperationLogService } from '../operation-log/operation-log.service'
import { BillingService } from '../billing/billing.service'
import { OutboundBillingService } from './outbound-billing.service'
import { InventoryMutationService } from '../../common/inventory/inventory-mutation.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { toCsv } from '../../common/csv.util'
import {
  APPOINTMENT_LABELS,
  OUTBOUND_STATUSES,
  OUTBOUND_STATUS_LABELS,
  ORDER_EXCEPTION_LABELS,
  PICKING_PROBLEM_LABELS,
  PICK_SOURCE_LABELS,
  REVIEW_SOURCE_LABELS,
  barcodeMatchesProduct,
  canApplyDeliveryOutcome,
  cargoTypeLabel,
  formatPickerStationLabel,
  formatWorkDate,
  isPostShipStatus,
  normalizeScanCode,
  outboundPickBlockedReason,
  parseDeliveryOutcome,
  parseWorkDate,
  pdaPickerMismatchReason,
  resolveCargoType,
  summarizeRemark,
  summarizeSkus,
  type PickSource,
  type ReviewSource,
} from './outbound.policy'
import { notifyOms } from '../../common/oms-notify.util'
import { erpFbaCodesForOmsWarehouse, outboundDestinationLabel } from './oms-warehouse.util'
import { toOmsLogisticsStatus, toOmsOutboundStatus } from './oms-status.util'
import {
  buildOutboundRemark,
  parseOmsOutboundMeta,
  parseOmsOutboundPreDeduct,
  parseOmsOutboundMeasure,
  parseOmsOutboundActualFees,
  upsertOutboundMeasureInRemark,
  upsertOutboundActualFeesInRemark,
  parseStockSourceFromRemark,
  stripOmsSystemTags,
  type OmsOutboundMeasure,
  type OmsOutboundActualFees,
} from '../../common/oms-sync-meta.util'
import {
  computeOutboundCartonMeasures,
  sumOutboundCartonTotals,
  type OutboundCartonInput,
} from './outbound-measure.util'
import {
  calculateOutboundActualFees,
  resolveFeeTemplateSnapshot,
} from './outbound-fee-calc.util'
import { CreateOmsOutboundDto } from './dto/oms-outbound.dto'
import {
  OutboundLabelValidationError,
  assertSkuLabelCounts,
  decodeAttachmentBase64,
  mergePdfBuffers,
  normalizeOmsOutboundAttachments,
  safePdfFilename,
  sortStoredLabels,
  type NormalizedOutboundAttachment,
  type OutboundAttachmentInput,
} from './outbound-label.util'

export type OutboundListQuery = PaginationDto & {
  keyword?: string
  status?: string
  warehouseCode?: string
  customerId?: string
  destType?: string
  /** OMS 履约目的仓 id：jhb1 / jhb3 / cpt1 … */
  destWarehouse?: string
  sku?: string
  createdFrom?: string
  createdTo?: string
  appointmentFrom?: string
  appointmentTo?: string
  logisticsProduct?: string
  carrier?: string
  pickerId?: string
  needsRelabel?: string
  isProblem?: string
  batchNo?: string
  platform?: string
  appointmentStatus?: string
  problemType?: string
  exceptionType?: string
}

export type OutboundRecipientPayload = {
  name: string
  province?: string
  city: string
  postalCode: string
  phone: string
  address1: string
  address2?: string
  email?: string
}

function normalizeRecipient(value: unknown): OutboundRecipientPayload | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const recipient = {
    name: String(raw.name || '').trim(),
    province: String(raw.province || '').trim() || undefined,
    city: String(raw.city || '').trim(),
    postalCode: String(raw.postalCode || '').trim(),
    phone: String(raw.phone || '').trim(),
    address1: String(raw.address1 || '').trim(),
    address2: String(raw.address2 || '').trim() || undefined,
    email: String(raw.email || '').trim() || undefined,
  }
  if (!recipient.name || !recipient.city || !recipient.postalCode || !recipient.phone || !recipient.address1) {
    throw new BadRequestException('一件代发缺少完整收件人姓名、城市、邮编、电话或地址')
  }
  return recipient
}

function parseRecipient(raw: string | null | undefined): OutboundRecipientPayload | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as OutboundRecipientPayload
  } catch {
    return null
  }
}

function idempotencyPayload(value: {
  customerCode: string
  warehouseCode?: string
  stockSource?: string
  items?: { sku: string; qty: number }[]
  preDeductTotal?: number
  recipient?: OutboundRecipientPayload | null
}) {
  return JSON.stringify({
    customerCode: value.customerCode.trim(),
    warehouseCode: String(value.warehouseCode || 'WMS-JHB-01').trim(),
    stockSource: value.stockSource === 'owned' ? 'owned' : 'catalog',
    items: (value.items || [])
      .map(item => ({ sku: String(item.sku).trim(), qty: Math.floor(Number(item.qty) || 0) }))
      .sort((a, b) => a.sku.localeCompare(b.sku) || a.qty - b.qty),
    preDeductTotal: Math.round((Number(value.preDeductTotal) || 0) * 100) / 100,
    recipient: value.recipient ?? null,
  })
}

@Injectable()
export class OutboundService {
  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
    private outboundBilling: OutboundBillingService,
    private inventoryMutation: InventoryMutationService,
    private files: FileStoreService,
    private opLog: OperationLogService,
  ) {}

  private runInTx<T>(
    tx: Prisma.TransactionClient | undefined,
    work: (client: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (tx) return work(tx)
    return this.prisma.$transaction(work, { timeout: 20000 })
  }

  private writeAttachment(fileName: string, contentBase64: string) {
    const buf = decodeAttachmentBase64(contentBase64)
    const storageName = fileName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    const { relativePath } = this.files.write(
      'outbound-attachments',
      `${Date.now()}_${randomUUID()}_${storageName}`,
      buf,
    )
    return {
      attachmentName: fileName,
      attachmentPath: relativePath,
      contentHash: createHash('sha256').update(buf).digest('hex'),
    }
  }

  private mapAttachments(rows: any[]) {
    return (rows || []).map((a) => ({
      id: Number(a.id),
      fileType: a.fileType,
      fileName: a.fileName,
      sku: a.sku || null,
      platformBarcode: a.platformBarcode || null,
      unitIndex: a.unitIndex ?? null,
      sourcePage: a.sourcePage ?? null,
      sourceRow: a.sourceRow ?? null,
      sourceColumn: a.sourceColumn ?? null,
      labelRole: a.labelRole || null,
      contentHash: a.contentHash || null,
      createdAt: this.fmtTime(a.createdAt),
      downloadable: Boolean(a.filePath && this.files.exists(a.filePath)),
    }))
  }

  private normalizeAttachmentInputs(
    attachments: OutboundAttachmentInput[] | undefined,
  ): NormalizedOutboundAttachment[] {
    try {
      return normalizeOmsOutboundAttachments(attachments)
    } catch (error) {
      if (error instanceof OutboundLabelValidationError) {
        throw new BadRequestException(error.message)
      }
      throw error
    }
  }

  private async persistAttachments(
    tx: any,
    outboundId: bigint,
    attachments: OutboundAttachmentInput[],
  ) {
    let first: { attachmentName: string; attachmentPath: string } | null = null
    for (const att of this.normalizeAttachmentInputs(attachments)) {
      const saved = this.writeAttachment(att.fileName, att.contentBase64)
      if (!first) first = saved
      await tx.outboundAttachment.create({
        data: {
          outboundId,
          fileType: att.fileType,
          fileName: saved.attachmentName,
          filePath: saved.attachmentPath,
          sku: att.sku,
          platformBarcode: att.platformBarcode,
          unitIndex: att.unitIndex,
          sourcePage: att.sourcePage,
          sourceRow: att.sourceRow,
          sourceColumn: att.sourceColumn,
          labelRole: att.labelRole,
          contentHash: att.contentHash || saved.contentHash,
        },
      })
    }
    return first
  }

  private fmtTime(d: Date | null | undefined) {
    if (!d) return ''
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  private buildListWhere(q: OutboundListQuery, opts?: { skipStatus?: boolean }) {
    const where: any = {}
    if (q.status && !opts?.skipStatus) where.status = q.status
    if (q.warehouseCode && q.warehouseCode !== 'all') where.warehouseCode = q.warehouseCode
    if (q.customerId) where.customerId = BigInt(q.customerId)
    if (q.destType && q.destType !== 'all') where.destType = q.destType
    if (q.destWarehouse && q.destWarehouse !== 'all') {
      const fbaCodes = erpFbaCodesForOmsWarehouse(q.destWarehouse)
      if (fbaCodes?.length) where.fbaWarehouse = { in: fbaCodes }
    }
    if (q.logisticsProduct && q.logisticsProduct !== 'all') {
      where.logisticsProduct = q.logisticsProduct
    }
    const carrier = q.carrier?.trim()
    if (carrier) where.carrier = { contains: carrier }
    if (q.pickerId) where.pickerId = BigInt(q.pickerId)
    if (q.needsRelabel === 'true') where.needsRelabel = true
    if (q.needsRelabel === 'false') where.needsRelabel = false
    if (q.isProblem === 'true') where.isProblem = true
    if (q.isProblem === 'false') where.isProblem = false
    if (q.problemType && q.problemType !== 'all') where.problemType = q.problemType
    if (q.exceptionType && q.exceptionType !== 'all') where.exceptionType = q.exceptionType
    const batchNo = q.batchNo?.trim()
    if (batchNo) where.batchNo = { contains: batchNo }
    if (q.platform && q.platform !== 'all') where.platform = q.platform
    if (q.appointmentStatus && q.appointmentStatus !== 'all') {
      where.appointmentStatus = q.appointmentStatus
    }
    if (q.appointmentFrom || q.appointmentTo) {
      where.appointmentDate = {}
      const from = parseWorkDate(q.appointmentFrom)
      const to = parseWorkDate(q.appointmentTo)
      if (from) where.appointmentDate.gte = from
      if (to) where.appointmentDate.lte = to
    }
    if (q.createdFrom || q.createdTo) {
      where.createdAt = {}
      if (q.createdFrom) where.createdAt.gte = new Date(q.createdFrom)
      if (q.createdTo) {
        const end = new Date(q.createdTo)
        end.setHours(23, 59, 59, 999)
        where.createdAt.lte = end
      }
    }
    const sku = q.sku?.trim()
    if (sku) {
      where.items = { some: { sku: { contains: sku } } }
    }
    const kw = q.keyword?.trim()
    if (kw) {
      where.OR = [
        { outboundNo: { contains: kw } },
        { fbaNo: { contains: kw } },
        { trackingNo: { contains: kw } },
        { batchNo: { contains: kw } },
      ]
    }
    return where
  }

  private async enrichOrders(rows: any[]) {
    const customerIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))] as bigint[]
    const pickerIds = [...new Set(rows.map((r) => r.pickerId).filter(Boolean))] as bigint[]
    const reviewerIds = [...new Set(rows.map((r) => r.reviewerId).filter(Boolean))] as bigint[]
    const userIds = [...new Set([...pickerIds, ...reviewerIds])]
    const customers = customerIds.length
      ? await this.prisma.customer.findMany({ where: { id: { in: customerIds } } })
      : []
    const users = userIds.length
      ? await this.prisma.sysUser.findMany({ where: { id: { in: userIds } } })
      : []
    const custMap = new Map(
      customers.map((c) => [
        Number(c.id),
        { name: c.customerName || c.customerCode, code: c.customerCode },
      ]),
    )
    const userMap = new Map(
      users.map((u) => [
        Number(u.id),
        { name: u.realName || u.username, workstation: u.workstation || '' },
      ]),
    )
    const productIds = [...new Set(
      rows.flatMap((r) => (r.items || []).map((i: any) => i.productId).filter(Boolean)),
    )] as bigint[]
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } } })
      : []
    const productMap = new Map(products.map((p) => [Number(p.id), p]))
    return rows.map((r) => ({
      id: Number(r.id),
      outboundNo: r.outboundNo,
      customerId: r.customerId ? Number(r.customerId) : null,
      customerCode: r.customerId ? custMap.get(Number(r.customerId))?.code || '' : '',
      customerName: r.customerId ? custMap.get(Number(r.customerId))?.name || '—' : '—',
      destination: outboundDestinationLabel(r),
      warehouseCode: r.warehouseCode,
      destType: r.destType,
      fbaNo: r.fbaNo || '',
      sellerStoreName: r.sellerStoreName || '',
      takealotSellerId: r.takealotSellerId || '',
      takealotBookingRef: r.takealotBookingRef || '',
      recipient: parseRecipient(r.recipientJson),
      shipmentDueDate: formatWorkDate(r.shipmentDueDate),
      trackingNo: r.trackingNo || '',
      logisticsProduct: r.logisticsProduct || '',
      carrier: r.carrier || '',
      cargoType: r.cargoType || '',
      cargoTypeLabel: cargoTypeLabel(r.cargoType),
      fbaWarehouse: r.fbaWarehouse || '',
      pickerId: r.pickerId ? Number(r.pickerId) : null,
      pickerName: r.pickerId ? userMap.get(Number(r.pickerId))?.name || '—' : '',
      pickerWorkstation: r.pickerId ? userMap.get(Number(r.pickerId))?.workstation || '' : '',
      batchNo: r.batchNo || '',
      platform: r.platform || '',
      appointmentStatus: r.appointmentStatus || '',
      appointmentStatusLabel: APPOINTMENT_LABELS[r.appointmentStatus || ''] || r.appointmentStatus || '—',
      appointmentDate: formatWorkDate(r.appointmentDate),
      reviewerId: r.reviewerId ? Number(r.reviewerId) : null,
      reviewerName: r.reviewerId ? userMap.get(Number(r.reviewerId))?.name || '—' : '',
      reviewedAt: r.reviewedAt ? this.fmtTime(r.reviewedAt) : null,
      reviewSource: r.reviewSource || '',
      reviewSourceLabel: REVIEW_SOURCE_LABELS[r.reviewSource || ''] || '',
      pickSource: r.pickSource || '',
      pickSourceLabel: PICK_SOURCE_LABELS[r.pickSource || ''] || '',
      pickingStartedAt: r.pickingStartedAt ? this.fmtTime(r.pickingStartedAt) : null,
      pickedAt: r.pickedAt ? this.fmtTime(r.pickedAt) : null,
      isPalletized: !!r.isPalletized,
      palletInfo: r.palletInfo || '',
      isProblem: !!r.isProblem,
      problemType: r.problemType || '',
      problemTypeLabel: PICKING_PROBLEM_LABELS[r.problemType || ''] || r.problemType || '',
      exceptionType: r.exceptionType || '',
      exceptionTypeLabel: ORDER_EXCEPTION_LABELS[r.exceptionType || ''] || r.exceptionType || '',
      problemRemark: r.problemRemark || '',
      exceptionFromStatus: (r as { exceptionFromStatus?: string | null }).exceptionFromStatus || '',
      status: r.status,
      needsRelabel: r.needsRelabel,
      relabelConfirmedAt: r.relabelConfirmedAt ? this.fmtTime(r.relabelConfirmedAt) : null,
      relabelPrintCount: r.relabelPrintCount ?? 0,
      remark: r.remark || '',
      customerRemark: stripOmsSystemTags(r.remark) || '',
      remarkSummary: summarizeRemark(stripOmsSystemTags(r.remark)),
      omsPreDeduct: parseOmsOutboundPreDeduct(r.remark),
      omsMeasure: parseOmsOutboundMeasure(r.remark),
      omsActualFees: parseOmsOutboundActualFees(r.remark),
      attachmentName: r.attachmentName || '',
      attachmentDownloadable: Boolean(r.attachmentPath && this.files.exists(r.attachmentPath)),
      attachments: this.mapAttachments(r.attachments),
      shippedAt: r.shippedAt ? this.fmtTime(r.shippedAt) : null,
      deliveredAt: r.deliveredAt ? this.fmtTime(r.deliveredAt) : null,
      podCode: r.podCode || '',
      podScannedAt: r.podScannedAt ? this.fmtTime(r.podScannedAt) : null,
      createdAt: this.fmtTime(r.createdAt),
      items: (r.items || []).map((i: any) => ({
        id: Number(i.id),
        productId: Number(i.productId),
        sku: i.sku,
        barcode: productMap.get(Number(i.productId))?.barcode || '',
        productName: i.productName || '',
        qty: i.qty,
        pickedQty: i.pickedQty ?? 0,
        locationCode: i.locationCode || '',
        oldBarcode: i.oldBarcode || '',
        newBarcode: i.newBarcode || '',
        relabelScannedAt: i.relabelScannedAt ? this.fmtTime(i.relabelScannedAt) : null,
        pickAllocations: (i.pickAllocations || []).map((a: any) => ({
          id: Number(a.id),
          locationCode: a.locationCode,
          qty: a.qty,
          status: a.status,
        })),
      })),
      totalQty: (r.items || []).reduce((s: number, i: any) => s + i.qty, 0),
      skuSummary: summarizeSkus(r.items || []),
    }))
  }

  async statusCounts(q: OutboundListQuery) {
    const base = this.buildListWhere(q, { skipStatus: true })
    const entries = await Promise.all([
      this.prisma.outboundOrder.count({ where: base }),
      ...OUTBOUND_STATUSES.map(async (status) => [
        status,
        await this.prisma.outboundOrder.count({ where: { ...base, status } }),
      ] as const),
      this.prisma.outboundOrder.count({ where: { ...base, isProblem: true } }),
    ])
    const counts: Record<string, number> = { all: entries[0] as number }
    OUTBOUND_STATUSES.forEach((status, i) => {
      counts[status] = (entries[i + 1] as [string, number])[1]
    })
    counts.problem = entries[entries.length - 1] as number
    return counts
  }

  async list(q: OutboundListQuery) {
    const { page, pageSize } = getPagination(q, 50)
    const where = this.buildListWhere(q)
    const [rows, total] = await Promise.all([
      this.prisma.outboundOrder.findMany({
        where,
        include: {
          items: true,
          attachments: {
            where: { fileType: { notIn: ['skuLabel', 'outerLabel'] } },
            orderBy: { id: 'asc' },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'desc' },
      }),
      this.prisma.outboundOrder.count({ where }),
    ])
    return { items: await this.enrichOrders(rows), total, page, pageSize }
  }

  async exportList(q: OutboundListQuery) {
    const where = this.buildListWhere(q)
    const rows = await this.prisma.outboundOrder.findMany({
      where,
      include: { items: true, attachments: { orderBy: { id: 'asc' } } },
      orderBy: { id: 'desc' },
      take: 5000,
    })
    const items = await this.enrichOrders(rows)
    const destLabel: Record<string, string> = { cpt: 'CPT自提', fba: 'FBA转运', local: '本地配送' }
    const headers = [
      '出库单号', '客户', '仓库', '目的地', '箱货类型', '目的仓', 'PO单号', '批次号', '平台', '预约状态', '预约送仓时间', 'SKU摘要', '件数', '状态',
      '物流产品', '承运商', '拣货员', '拣货来源', '复核人', '复核来源', '复核时间', '打托', '打托信息', '跟踪号', '换标', '问题件',
      'POD', '备注', '创建时间', '发运时间', '送达时间',
    ]
    const dataRows = items.map((r) => [
      r.outboundNo,
      r.customerName,
      r.warehouseCode,
      destLabel[r.destType] || r.destType,
      r.cargoTypeLabel || r.cargoType,
      r.fbaWarehouse,
      r.fbaNo,
      r.batchNo,
      r.platform,
      r.appointmentStatusLabel,
      r.appointmentDate || '',
      r.skuSummary,
      r.totalQty,
      OUTBOUND_STATUS_LABELS[r.status] || r.status,
      r.logisticsProduct,
      r.carrier,
      r.pickerName ? formatPickerStationLabel(r.pickerName, r.pickerWorkstation) : '',
      r.pickSourceLabel || '',
      r.reviewerName,
      r.reviewSourceLabel || '',
      r.reviewedAt || '',
      r.isPalletized ? '是' : '否',
      r.palletInfo,
      r.trackingNo,
      r.needsRelabel ? '是' : '否',
      r.isProblem ? '是' : '否',
      r.podCode || '',
      r.customerRemark || r.remark,
      r.createdAt,
      r.shippedAt || '',
      r.deliveredAt || '',
    ])
    return toCsv(headers, dataRows)
  }

  async detail(id: number) {
    const row = await this.prisma.outboundOrder.findUnique({
      where: { id: BigInt(id) },
      include: {
        items: { include: { pickAllocations: { orderBy: { id: 'asc' } } } },
        attachments: { orderBy: { id: 'asc' } },
      },
    })
    if (!row) throw new NotFoundException('出库单不存在')
    const [item] = await this.enrichOrders([row])
    return item
  }

  async create(data: any, operatorId?: number, tx?: Prisma.TransactionClient) {
    const warehouseCode = data.warehouseCode?.trim()
    if (!warehouseCode) throw new BadRequestException('请指定出库仓库')
    const lines: any[] = data.items || []
    if (!lines.length) throw new BadRequestException('请添加出库明细')

    const outboundNo = data.outboundNo?.trim() || `OB-${Date.now().toString().slice(-8)}`
    const needsRelabel = !!data.needsRelabel
    const initialStatus = 'pending_pick'
    const destType = data.destType || 'cpt'
    const platform = data.platform?.trim() || null
    const cargoType =
      data.cargoType?.trim()
      || resolveCargoType({
        destType,
        needsRelabel,
        platform,
        outboundType: data.outboundType,
      })
    const fbaWarehouse = data.fbaWarehouse?.trim() || null

    const attachmentInputs: OutboundAttachmentInput[] = []
    if (Array.isArray(data.attachments)) {
      attachmentInputs.push(...data.attachments)
    }
    if (data.contentBase64 && data.fileName) {
      attachmentInputs.push({
        fileType: data.fileType || 'other',
        fileName: data.fileName,
        contentBase64: data.contentBase64,
      })
    }
    const normalizedAttachments = this.normalizeAttachmentInputs(attachmentInputs)

    return this.runInTx(tx, async (client) => {
      const warehouse = await client.warehouse.findUnique({ where: { warehouseCode } })
      if (!warehouse) throw new BadRequestException(`出库仓库不存在：${warehouseCode}`)
      let requiredFiles: string[] = []
      try {
        const parsed = JSON.parse(warehouse.requiredOutboundFiles || '[]')
        if (Array.isArray(parsed)) requiredFiles = parsed.map(String)
      } catch {
        requiredFiles = []
      }
      const providedTypes = new Set(normalizedAttachments.map(item => item.fileType))
      const missingTypes = requiredFiles.filter(fileType => !providedTypes.has(fileType))
      if (missingTypes.length) {
        const labels: Record<string, string> = {
          outerLabel: '外箱标签', skuLabel: 'SKU 标签', deliveryList: '送货清单', appointment: '预约文件',
        }
        throw new BadRequestException(
          `${warehouse.warehouseName} 缺少必传文件：${missingTypes.map(item => labels[item] || item).join('、')}`,
        )
      }
      for (const line of lines) {
        const qty = Number(line.qty)
        if (qty <= 0) throw new BadRequestException(`${line.sku} 数量须大于 0`)
        const productId = BigInt(line.productId)
        const inv = await client.inventory.findUnique({
          where: { productId_warehouseCode: { productId, warehouseCode } },
        })
        if (!inv || inv.availableQty < qty) {
          throw new BadRequestException(`${line.sku} 可用库存不足（可用 ${inv?.availableQty ?? 0}，需要 ${qty}）`)
        }
      }

      const order = await client.outboundOrder.create({
        data: {
          outboundNo,
          customerId: data.customerId ? BigInt(data.customerId) : null,
          warehouseCode,
          destType,
          fbaNo: data.fbaNo?.trim() || null,
          sellerStoreName: data.sellerStoreName?.trim() || null,
          takealotSellerId: data.takealotSellerId?.trim() || null,
          takealotBookingRef: data.takealotBookingRef?.trim() || null,
          shipmentDueDate: parseWorkDate(data.shipmentDueDate),
          trackingNo: data.trackingNo?.trim() || null,
          logisticsProduct: data.logisticsProduct?.trim() || null,
          carrier: data.carrier?.trim() || null,
          cargoType,
          fbaWarehouse,
          batchNo: data.batchNo?.trim() || null,
          platform,
          appointmentStatus: data.appointmentStatus?.trim() || (data.appointmentDate ? 'scheduled' : null),
          appointmentDate: parseWorkDate(data.appointmentDate),
          status: initialStatus,
          needsRelabel,
          remark: data.remark?.trim() || null,
          recipientJson: data.recipient ? JSON.stringify(normalizeRecipient(data.recipient)) : null,
          createdBy: operatorId ? BigInt(operatorId) : null,
          items: {
            create: lines.map((l) => ({
              productId: BigInt(l.productId),
              sku: l.sku,
              productName: l.productName || null,
              qty: Number(l.qty),
            })),
          },
        },
        include: { items: true, attachments: true },
      })

      const firstAttachment = normalizedAttachments.length
        ? await this.persistAttachments(client, order.id, normalizedAttachments)
        : null
      if (firstAttachment) {
        await client.outboundOrder.update({
          where: { id: order.id },
          data: {
            attachmentName: firstAttachment.attachmentName,
            attachmentPath: firstAttachment.attachmentPath,
          },
        })
      }

      const fullOrder = await client.outboundOrder.findUnique({
        where: { id: order.id },
        include: { items: true, attachments: { orderBy: { id: 'asc' } } },
      })
      if (!fullOrder) throw new BadRequestException('创建出库单失败')

      for (const item of fullOrder.items) {
        const inv = await client.inventory.findUnique({
          where: {
            productId_warehouseCode: { productId: item.productId, warehouseCode },
          },
        })!
        await client.inventory.update({
          where: { id: inv!.id },
          data: {
            availableQty: inv!.availableQty - item.qty,
            lockedQty: inv!.lockedQty + item.qty,
          },
        })
      }

      const [result] = await this.enrichOrders([fullOrder])
      return result
    })
  }

  async confirmRelabel(
    id: number,
    payload?: {
      items?: { id: number; scannedBarcode: string; newBarcode?: string }[]
      allowSkipScan?: boolean
    },
  ) {
    const order = await this.prisma.outboundOrder.findUnique({
      where: { id: BigInt(id) },
      include: { items: true },
    })
    if (!order) throw new NotFoundException('出库单不存在')
    if (order.status !== 'pending_relabel') throw new BadRequestException('当前状态不可确认换标')

    const scans = payload?.items || []
    if (!scans.length && !payload?.allowSkipScan) {
      throw new BadRequestException('请扫描旧条码完成换标确认（或显式允许跳过扫码）')
    }

    if (scans.length) {
      const lineMap = new Map(order.items.map((i) => [Number(i.id), i]))
      const productIds = order.items.map((i) => i.productId)
      const products = await this.prisma.product.findMany({ where: { id: { in: productIds } } })
      const productMap = new Map(products.map((p) => [Number(p.id), p]))

      for (const scan of scans) {
        const item = lineMap.get(Number(scan.id))
        if (!item) throw new BadRequestException(`明细 ${scan.id} 不存在`)
        const product = productMap.get(Number(item.productId))
        if (!product) throw new BadRequestException(`${item.sku} 商品不存在`)
        const code = normalizeScanCode(scan.scannedBarcode)
        if (!code) throw new BadRequestException(`${item.sku} 请扫描旧条码`)
        if (!barcodeMatchesProduct(code, product)) {
          throw new BadRequestException(`${item.sku} 扫描码与商品条码/SKU 不匹配`)
        }
      }

      const scannedIds = new Set(scans.map((s) => Number(s.id)))
      const missing = order.items.filter((i) => !scannedIds.has(Number(i.id)))
      if (missing.length) {
        throw new BadRequestException(`仍有 ${missing.length} 个 SKU 未扫码换标：${missing.map((i) => i.sku).join('、')}`)
      }

      const printCount = order.items.reduce((s, i) => s + i.qty, 0)
      // 新流程：复核后换标 → 待发运；兼容旧单（尚未拣货就换标）→ 待拣货
      const nextStatus =
        order.reviewedAt || order.items.some((i) => (i.pickedQty ?? 0) > 0)
          ? 'packed'
          : 'pending_pick'

      await this.prisma.$transaction(async (tx) => {
        for (const scan of scans) {
          await tx.outboundOrderItem.update({
            where: { id: BigInt(scan.id) },
            data: {
              oldBarcode: normalizeScanCode(scan.scannedBarcode),
              newBarcode: scan.newBarcode?.trim() || null,
              relabelScannedAt: new Date(),
            },
          })
        }
        await tx.outboundOrder.update({
          where: { id: BigInt(id) },
          data: {
            status: nextStatus,
            relabelConfirmedAt: new Date(),
            relabelPrintCount: printCount,
          },
        })
      })
    } else {
      const printCount = order.items.reduce((s, i) => s + i.qty, 0)
      const nextStatus =
        order.reviewedAt || order.items.some((i) => (i.pickedQty ?? 0) > 0)
          ? 'packed'
          : 'pending_pick'
      await this.prisma.outboundOrder.update({
        where: { id: BigInt(id) },
        data: {
          status: nextStatus,
          relabelConfirmedAt: new Date(),
          relabelPrintCount: printCount,
        },
      })
    }
    return this.detail(id)
  }

  async uploadAttachment(
    id: number,
    data: OutboundAttachmentInput,
  ) {
    const attachment = this.normalizeAttachmentInputs([data])[0]
    const order = await this.prisma.outboundOrder.findUnique({ where: { id: BigInt(id) } })
    if (!order) throw new NotFoundException('出库单不存在')
    if (order.status === 'cancelled') throw new BadRequestException('已取消不可上传附件')
    const fileType = attachment.fileType
    if (fileType !== 'pod' && isPostShipStatus(order.status)) {
      throw new BadRequestException('当前状态不可上传该类型附件')
    }
    await this.prisma.$transaction(async (tx) => {
      const saved = await this.persistAttachments(tx, BigInt(id), [attachment])
      if (saved && !order.attachmentPath && fileType !== 'pod') {
        await tx.outboundOrder.update({
          where: { id: BigInt(id) },
          data: { attachmentName: saved.attachmentName, attachmentPath: saved.attachmentPath },
        })
      }
    })
    if (fileType === 'pod' && order.outboundNo) {
      await this.pushOutboundStatusToOms(order.outboundNo)
    }
    return this.detail(id)
  }

  async downloadPodAttachment(id: number) {
    const att = await this.prisma.outboundAttachment.findFirst({
      where: { outboundId: BigInt(id), fileType: 'pod' },
      orderBy: { id: 'desc' },
    })
    if (!att) throw new NotFoundException('该出库单暂无 POD 签收单')
    if (!att.filePath || !this.files.exists(att.filePath)) {
      throw new NotFoundException('POD 签收单文件不存在，可能未同步到本机或已被清理')
    }
    return { fileName: att.fileName, content: this.files.read(att.filePath) }
  }

  async downloadAttachment(id: number, attachmentId?: number) {
    if (attachmentId != null && Number.isFinite(attachmentId) && attachmentId > 0) {
      const att = await this.prisma.outboundAttachment.findFirst({
        where: { id: BigInt(attachmentId), outboundId: BigInt(id) },
      })
      if (!att) throw new NotFoundException('附件不存在')
      if (!att.filePath || !this.files.exists(att.filePath)) {
        throw new NotFoundException('附件文件不存在，可能未同步到本机或已被清理')
      }
      return { fileName: att.fileName, content: this.files.read(att.filePath) }
    }
    const order = await this.prisma.outboundOrder.findUnique({ where: { id: BigInt(id) } })
    if (!order?.attachmentPath) {
      const first = await this.prisma.outboundAttachment.findFirst({
        where: { outboundId: BigInt(id) },
        orderBy: { id: 'asc' },
      })
      if (!first) throw new NotFoundException('该出库单无附件')
      if (!first.filePath || !this.files.exists(first.filePath)) {
        throw new NotFoundException('附件文件不存在，可能未同步到本机或已被清理')
      }
      return { fileName: first.fileName, content: this.files.read(first.filePath) }
    }
    if (!this.files.exists(order.attachmentPath)) {
      throw new NotFoundException('附件文件不存在，可能未同步到本机或已被清理')
    }
    return {
      fileName: order.attachmentName || 'attachment',
      content: this.files.read(order.attachmentPath),
    }
  }

  private async getLabelOrder(id: number, sku?: string) {
    const order = await this.prisma.outboundOrder.findUnique({
      where: { id: BigInt(id) },
      include: { items: { orderBy: { id: 'asc' } } },
    })
    if (!order) throw new NotFoundException('出库单不存在')
    const normalizedSku = String(sku || '').trim()
    if (sku != null && !normalizedSku) throw new BadRequestException('缺少 SKU')
    if (normalizedSku && !order.items.some((item) => item.sku === normalizedSku)) {
      throw new BadRequestException(`SKU ${normalizedSku} 不属于出库单 ${order.outboundNo}`)
    }
    return { order, sku: normalizedSku }
  }

  private async mergeStoredLabels(attachments: { filePath: string }[]) {
    try {
      return await mergePdfBuffers(attachments.map((attachment) => this.files.read(attachment.filePath)))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('pdf-lib dependency')) {
        throw new ServiceUnavailableException('标签合并服务缺少 pdf-lib 依赖')
      }
      throw new BadRequestException(`标签 PDF 合并失败：${message}`)
    }
  }

  async downloadUnitLabel(id: number, sku: string, unitIndex: number) {
    const context = await this.getLabelOrder(id, sku)
    if (!Number.isInteger(unitIndex) || unitIndex < 1) {
      throw new BadRequestException('unitIndex 必须是大于等于 1 的整数')
    }
    const attachment = await this.prisma.outboundAttachment.findFirst({
      where: {
        outboundId: context.order.id,
        fileType: 'skuLabel',
        sku: context.sku,
        unitIndex,
      },
      orderBy: { id: 'asc' },
    })
    if (!attachment || attachment.labelRole === 'sourceDocument') {
      throw new NotFoundException(
        `出库单 ${context.order.outboundNo} 的 SKU ${context.sku} 不存在第 ${unitIndex} 张标签`,
      )
    }
    return {
      fileName: safePdfFilename(context.order.outboundNo, context.sku, `unit-${unitIndex}`),
      content: this.files.read(attachment.filePath),
    }
  }

  async downloadSkuLabels(id: number, sku: string) {
    const context = await this.getLabelOrder(id, sku)
    const storedAttachments = await this.prisma.outboundAttachment.findMany({
      where: {
        outboundId: context.order.id,
        fileType: 'skuLabel',
        sku: context.sku,
      },
    })
    const attachments = storedAttachments.filter(
      (attachment) =>
        attachment.labelRole !== 'sourceDocument'
        && attachment.unitIndex != null,
    )
    if (!attachments.length) {
      throw new NotFoundException(`出库单 ${context.order.outboundNo} 的 SKU ${context.sku} 暂无标签`)
    }
    const ordered = sortStoredLabels(attachments)
    return {
      fileName: safePdfFilename(context.order.outboundNo, context.sku, 'labels'),
      content: await this.mergeStoredLabels(ordered),
    }
  }

  async downloadOutboundLabels(id: number) {
    const context = await this.getLabelOrder(id)
    const storedAttachments = await this.prisma.outboundAttachment.findMany({
      where: {
        outboundId: context.order.id,
        fileType: 'skuLabel',
      },
    })
    const attachments = storedAttachments.filter(
      (attachment) =>
        attachment.labelRole !== 'sourceDocument'
        && attachment.sku != null
        && attachment.unitIndex != null,
    )
    if (!attachments.length) {
      throw new NotFoundException(`出库单 ${context.order.outboundNo} 暂无 SKU 标签`)
    }
    const lineSkus = context.order.items.map((item) => item.sku)
    const lineSkuSet = new Set(lineSkus)
    const invalid = attachments.find((attachment) => !attachment.sku || !lineSkuSet.has(attachment.sku))
    if (invalid) {
      throw new BadRequestException(`标签附件 ${invalid.id} 的 SKU 不属于当前出库单`)
    }
    const ordered = sortStoredLabels(attachments, lineSkus)
    return {
      fileName: safePdfFilename(context.order.outboundNo, 'labels'),
      content: await this.mergeStoredLabels(ordered),
    }
  }

  async assignPicker(ids: number[], pickerId: number) {
    if (!pickerId) throw new BadRequestException('请选择拣货员')
    if (!ids?.length) throw new BadRequestException('请选择出库单')
    const picker = await this.prisma.sysUser.findUnique({ where: { id: BigInt(pickerId) } })
    if (!picker || picker.status !== 1) throw new BadRequestException('拣货员不存在或已停用')

    const orders = await this.prisma.outboundOrder.findMany({
      where: { id: { in: ids.map((id) => BigInt(id)) } },
    })
    if (orders.length !== ids.length) throw new BadRequestException('部分出库单不存在')
    const invalid = orders.filter((o) => o.status !== 'pending_pick')
    if (invalid.length) {
      throw new BadRequestException(`仅待拣货状态可分配拣货员：${invalid.map((o) => o.outboundNo).join('、')}`)
    }

    await this.prisma.outboundOrder.updateMany({
      where: { id: { in: ids.map((id) => BigInt(id)) } },
      data: {
        pickerId: BigInt(pickerId),
        status: 'picking',
        pickingStartedAt: new Date(),
      },
    })
    return {
      updated: ids.length,
      pickerId,
      pickerName: picker.realName || picker.username,
      pickerWorkstation: picker.workstation || null,
    }
  }

  async setProblem(
    id: number,
    payload: {
      markType?: 'problem' | 'exception' | 'clear_problem' | 'clear_exception'
      problemRemark?: string
      problemType?: string
      exceptionType?: string
      /** @deprecated 请使用 markType */
      isProblem?: boolean
    },
  ) {
    const order = await this.prisma.outboundOrder.findUnique({ where: { id: BigInt(id) } })
    if (!order) throw new NotFoundException('出库单不存在')
    if (order.status === 'cancelled') throw new BadRequestException('已取消单不可变更标记')

    let markType = payload.markType
    if (!markType && payload.isProblem === true) markType = 'problem'
    if (!markType && payload.isProblem === false) {
      markType = order.status === 'exception' ? 'clear_exception' : 'clear_problem'
    }
    if (!markType) throw new BadRequestException('请指定 markType')

    const blocked = ['shipped', 'delivered', 'partial_delivered', 'delivery_failed', 'cancelled']

    switch (markType) {
      case 'problem':
        if (blocked.includes(order.status)) {
          throw new BadRequestException('当前状态不可标记问题件')
        }
        if (!payload.problemType || !PICKING_PROBLEM_LABELS[payload.problemType]) {
          throw new BadRequestException('请选择有效的拣货问题类型')
        }
        await this.prisma.outboundOrder.update({
          where: { id: BigInt(id) },
          data: {
            isProblem: true,
            problemType: payload.problemType,
            problemRemark: payload.problemRemark?.trim() || order.problemRemark,
          },
        })
        break
      case 'exception':
        if (blocked.includes(order.status)) {
          throw new BadRequestException('当前状态不可标记异常')
        }
        if (order.status === 'exception') {
          throw new BadRequestException('出库单已处于异常状态')
        }
        if (!payload.exceptionType || !ORDER_EXCEPTION_LABELS[payload.exceptionType]) {
          throw new BadRequestException('请选择有效的订单异常类型')
        }
        await this.prisma.outboundOrder.update({
          where: { id: BigInt(id) },
          data: {
            exceptionFromStatus: order.status,
            exceptionType: payload.exceptionType,
            status: 'exception',
            problemRemark: payload.problemRemark?.trim() || order.problemRemark,
          },
        })
        break
      case 'clear_problem':
        await this.prisma.outboundOrder.update({
          where: { id: BigInt(id) },
          data: { isProblem: false, problemType: null, problemRemark: null },
        })
        break
      case 'clear_exception':
        if (order.status !== 'exception') {
          throw new BadRequestException('仅异常状态可解除异常')
        }
        await this.prisma.outboundOrder.update({
          where: { id: BigInt(id) },
          data: {
            status: order.exceptionFromStatus || 'pending_pick',
            exceptionFromStatus: null,
            exceptionType: null,
          },
        })
        break
      default:
        throw new BadRequestException('无效的 markType')
    }
    return this.detail(id)
  }

  private suggestPickLocations(warehouseCode: string, sku: string, needQty: number) {
    return this.prisma.inventoryLocation.findMany({
      where: { warehouseCode, sku, qty: { gt: 0 } },
      orderBy: [{ locationCode: 'asc' }],
    }).then((locs) => {
      const suggestions: { locationCode: string; pickQty: number; available: number }[] = []
      const byLocation = new Map<string, number>()
      for (const loc of locs) {
        byLocation.set(loc.locationCode, (byLocation.get(loc.locationCode) || 0) + loc.qty)
      }
      let remaining = needQty
      for (const [locationCode, available] of byLocation) {
        if (remaining <= 0) break
        const pickQty = Math.min(remaining, available)
        suggestions.push({ locationCode, pickQty, available })
        remaining -= pickQty
      }
      const primary = suggestions[0]?.locationCode || ''
      return { suggestions, primary, uncovered: Math.max(0, remaining) }
    })
  }

  async buildPickListHtml(id: number) {
    const order = await this.prisma.outboundOrder.findUnique({
      where: { id: BigInt(id) },
      include: { items: true },
    })
    if (!order) throw new NotFoundException('出库单不存在')

    let pickerName = ''
    let pickerWorkstation = ''
    if (order.pickerId) {
      const picker = await this.prisma.sysUser.findUnique({ where: { id: order.pickerId } })
      pickerName = picker?.realName || picker?.username || ''
      pickerWorkstation = picker?.workstation || ''
    }

    const lines = await Promise.all(
      order.items.map(async (item) => {
        const plan = await this.suggestPickLocations(order.warehouseCode, item.sku, item.qty)
        return {
          sku: item.sku,
          productName: item.productName || '',
          qty: item.qty,
          ...plan,
        }
      }),
    )

    const rowsHtml = lines.map((line) => {
      const locText = line.suggestions.length
        ? line.suggestions.map((s) => `${s.locationCode}（拣 ${s.pickQty} / 库 ${s.available}）`).join('<br/>')
        : '— 暂无库位库存 —'
      const warn = line.uncovered > 0 ? `<div class="warn">缺 ${line.uncovered} 件，请核对库存</div>` : ''
      return `<tr>
        <td>${line.sku}</td>
        <td>${line.productName || '—'}</td>
        <td class="num">${line.qty}</td>
        <td class="loc">${locText}${warn}</td>
      </tr>`
    }).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>拣货清单 ${order.outboundNo}</title>
<style>
body{font-family:Arial,sans-serif;padding:20px;font-size:13px;color:#222}
h2{margin:0 0 8px}
.meta{color:#666;margin-bottom:16px;line-height:1.6}
table{width:100%;border-collapse:collapse;margin-top:12px}
th,td{border:1px solid #ccc;padding:8px 10px;text-align:left;vertical-align:top}
th{background:#f5f5f5}
.num{text-align:right;white-space:nowrap}
.loc{font-family:Consolas,monospace;font-size:12px;line-height:1.5}
.warn{color:#c45656;font-size:11px;margin-top:4px}
@media print { .no-print { display:none } }
</style></head><body>
<h2>出库拣货清单</h2>
<div class="meta">
  出库单：<strong>${order.outboundNo}</strong><br/>
  仓库：${order.warehouseCode} · 状态：${OUTBOUND_STATUS_LABELS[order.status] || order.status}<br/>
  拣货员：${formatPickerStationLabel(pickerName, pickerWorkstation)} · 打印时间：${new Date().toLocaleString('zh-CN')}
</div>
<table>
  <thead><tr><th>SKU</th><th>品名</th><th>应拣</th><th>拣货库位（建议）</th></tr></thead>
  <tbody>${rowsHtml}</tbody>
</table>
<div class="no-print" style="margin-top:16px"><button onclick="window.print()">打印</button></div>
<script>window.onload=function(){window.print()}<\/script>
</body></html>`

    return {
      fileName: `拣货清单_${order.outboundNo}.html`,
      content: Buffer.from(html, 'utf-8'),
      mimeType: 'text/html;charset=utf-8',
    }
  }

  async getPickSuggestions(id: number) {
    const order = await this.prisma.outboundOrder.findUnique({
      where: { id: BigInt(id) },
      include: { items: true },
    })
    if (!order) throw new NotFoundException('出库单不存在')
    const blocked = outboundPickBlockedReason(order)
    if (blocked) throw new BadRequestException(blocked)

    const productIds = [...new Set(order.items.map((item) => item.productId))]
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } } })
      : []
    const productMap = new Map(products.map((p) => [Number(p.id), p]))
    const items = await Promise.all(
      order.items.map(async (item) => {
        const pickQty = item.pickedQty && item.pickedQty > 0 ? item.pickedQty : item.qty
        const plan = await this.suggestPickLocations(order.warehouseCode, item.sku, pickQty)
        return {
          id: Number(item.id),
          sku: item.sku,
          barcode: productMap.get(Number(item.productId))?.barcode || '',
          productName: item.productName || '',
          qty: item.qty,
          pickedQty: pickQty,
          locationCode: item.locationCode || plan.primary,
          suggestions: plan.suggestions,
          uncovered: plan.uncovered,
        }
      }),
    )
    return {
      outboundNo: order.outboundNo,
      warehouseCode: order.warehouseCode,
      items,
    }
  }

  async pick(
    id: number,
    payload: {
      items: {
        id: number
        locationCode?: string
        pickedQty?: number
        allocations?: { locationCode: string; qty: number }[]
      }[]
      pickSource?: PickSource
    },
    operatorId?: number,
  ) {
    const order = await this.prisma.outboundOrder.findUnique({
      where: { id: BigInt(id) },
      include: { items: true },
    })
    if (!order) throw new NotFoundException('出库单不存在')
    if (order.status === 'exception') throw new BadRequestException('异常单已暂停流程，请先解除异常')
    const blocked = outboundPickBlockedReason(order)
    if (blocked) throw new BadRequestException(blocked)

    const pickSource: PickSource = payload.pickSource === 'pda' ? 'pda' : 'pick_list'
    if (pickSource === 'pda') {
      const mismatch = pdaPickerMismatchReason(order.pickerId, operatorId)
      if (mismatch) throw new BadRequestException(mismatch)
    }
    if (!payload.items?.length) throw new BadRequestException('请提交拣货明细')
    const lineMap = new Map(order.items.map((i) => [Number(i.id), i]))
    const submittedIds = new Set<number>()
    const resolvedLines: {
      id: number
      item: (typeof order.items)[number]
      allocations: { locationCode: string; qty: number }[]
    }[] = []
    for (const line of payload.items || []) {
      const lineId = Number(line.id)
      const item = lineMap.get(lineId)
      if (!item) throw new BadRequestException(`明细 ${line.id} 不存在`)
      if (submittedIds.has(lineId)) throw new BadRequestException(`明细 ${line.id} 重复提交`)
      submittedIds.add(lineId)

      let requested = Array.isArray(line.allocations)
        ? line.allocations
        : line.locationCode?.trim()
          ? [{ locationCode: line.locationCode, qty: line.pickedQty ?? item.qty }]
          : []
      if (!requested.length) {
        const plan = await this.suggestPickLocations(order.warehouseCode, item.sku, item.qty)
        requested = plan.suggestions.map((s) => ({ locationCode: s.locationCode, qty: s.pickQty }))
      }
      const aggregated = new Map<string, number>()
      for (const allocation of requested) {
        const locationCode = allocation.locationCode?.trim().toUpperCase()
        const qty = Number(allocation.qty)
        if (!locationCode || !Number.isInteger(qty) || qty <= 0) {
          throw new BadRequestException(`${item.sku} 的库位或拣货数量无效`)
        }
        aggregated.set(locationCode, (aggregated.get(locationCode) || 0) + qty)
      }
      const allocations = [...aggregated].map(([locationCode, qty]) => ({ locationCode, qty }))
      const pickedQty = allocations.reduce((sum, allocation) => sum + allocation.qty, 0)
      if (!allocations.length) {
        throw new BadRequestException(`${item.sku} 无可用库位，请先完成上架或库存分配`)
      }
      if (pickedQty !== item.qty) {
        throw new BadRequestException(
          `${item.sku} 必须完整拣货（应拣 ${item.qty}，实拣 ${pickedQty}）；短拣请标记库存短缺异常`,
        )
      }
      resolvedLines.push({ id: lineId, item, allocations })
    }
    if (submittedIds.size !== order.items.length) {
      const missing = order.items.filter((item) => !submittedIds.has(Number(item.id))).map((item) => item.sku)
      throw new BadRequestException(`拣货明细不完整，缺少：${missing.join('、')}`)
    }

    await this.prisma.$transaction(async (tx) => {
      for (const line of resolvedLines) {
        for (const allocation of line.allocations) {
          const loc = await tx.warehouseLocation.findFirst({
            where: { warehouseCode: order.warehouseCode, locationCode: allocation.locationCode },
          })
          if (!loc) throw new BadRequestException(`库位 ${allocation.locationCode} 不存在`)

          const deductedLines = await this.inventoryMutation.deductLocationQtyFifo(tx, {
            locationId: loc.id,
            sku: line.item.sku,
            qty: allocation.qty,
          })
          for (const deducted of deductedLines) {
            await tx.outboundPickAllocation.create({
              data: {
                outboundId: order.id,
                outboundItemId: line.item.id,
                productId: line.item.productId,
                sku: line.item.sku,
                warehouseCode: order.warehouseCode,
                locationId: loc.id,
                inventoryLocationId: deducted.inventoryLocationId,
                locationCode: allocation.locationCode,
                qty: deducted.qty,
                operatorId: operatorId ? BigInt(operatorId) : null,
              },
            })
          }
        }
        await tx.outboundOrderItem.update({
          where: { id: BigInt(line.id) },
          data: {
            locationCode: line.allocations[0].locationCode,
            pickedQty: line.item.qty,
          },
        })
      }
      const transitioned = await tx.outboundOrder.updateMany({
        where: { id: BigInt(id), status: 'picking' },
        data: {
          status: 'picked',
          pickedAt: new Date(),
          pickSource,
          pickerId: order.pickerId,
          pickingStartedAt: order.pickingStartedAt || new Date(),
        },
      })
      if (transitioned.count !== 1) {
        throw new BadRequestException('出库单状态已变化，请刷新后重试')
      }
    })
    await this.opLog.log({
      operatorId,
      module: 'outbound',
      action: 'pick',
      targetType: 'outbound_order',
      targetId: order.outboundNo,
      detail: {
        pickSource,
        allocations: resolvedLines.flatMap((line) =>
          line.allocations.map((allocation) => ({ sku: line.item.sku, ...allocation })),
        ),
      },
    })
    return {
      id,
      outboundNo: order.outboundNo,
      status: 'picked',
    }
  }

  async startReview(id: number, operatorId?: number) {
    const order = await this.prisma.outboundOrder.findUnique({ where: { id: BigInt(id) } })
    if (!order) throw new NotFoundException('出库单不存在')
    if (order.status === 'exception') throw new BadRequestException('异常单已暂停流程，请先解除异常')
    if (order.status === 'reviewing') return this.detail(id)
    if (order.status !== 'picked') {
      throw new BadRequestException('仅已拣货状态可开始复核')
    }
    await this.prisma.outboundOrder.update({
      where: { id: BigInt(id) },
      data: { status: 'reviewing' },
    })
    await this.opLog.log({
      operatorId,
      module: 'outbound',
      action: 'start_review',
      targetType: 'outbound_order',
      targetId: order.outboundNo,
      detail: { reviewSource: 'pda_or_web' },
    })
    return this.detail(id)
  }

  async pack(
    id: number,
    payload?: {
      isPalletized?: boolean
      palletInfo?: string
      reviewSource?: ReviewSource
      cartons?: OutboundCartonInput[]
    },
    operatorId?: number,
  ) {
    const order = await this.prisma.outboundOrder.findUnique({
      where: { id: BigInt(id) },
      include: { items: true },
    })
    if (!order) throw new NotFoundException('出库单不存在')
    if (order.status === 'exception') throw new BadRequestException('异常单已暂停流程，请先解除异常')
    if (!['picked', 'reviewing'].includes(order.status)) {
      throw new BadRequestException('当前状态不可复核（需先完成拣货）')
    }
    const reviewSource: ReviewSource = payload?.reviewSource === 'pda' ? 'pda' : 'pick_list'
    const nextStatus = order.needsRelabel ? 'pending_relabel' : 'packed'

    let remark = order.remark || ''
    const preDeduct = parseOmsOutboundPreDeduct(remark)
    const meta = parseOmsOutboundMeta(remark)
    const cartonsInput = Array.isArray(payload?.cartons) ? payload!.cartons! : []

    if (preDeduct && cartonsInput.length === 0) {
      throw new BadRequestException('OMS 出库单请录入外箱实测尺寸与重量')
    }

    if (cartonsInput.length > 0) {
      const computed = computeOutboundCartonMeasures(cartonsInput)
      const totals = sumOutboundCartonTotals(computed)
      const measuredAt = new Date().toISOString()
      const measure: OmsOutboundMeasure = {
        cartons: computed,
        totalVolumeM3: totals.totalVolumeM3,
        totalWeightKg: totals.totalWeightKg,
        measuredAt,
      }
      const totalQty = order.items.reduce((s, i) => s + (i.pickedQty || i.qty), 0)
      const snapshot = resolveFeeTemplateSnapshot(preDeduct?.templateSnapshot, {
        shippingMethod: meta.shippingMethod || order.logisticsProduct || undefined,
        destRegion: preDeduct?.destRegion || meta.destRegion,
      })
      const { lines, total } = calculateOutboundActualFees({
        totalVolumeM3: totals.totalVolumeM3,
        totalWeightKg: totals.totalWeightKg,
        totalQty,
        skuLineCount: order.items.length,
        snapshot,
      })
      const actualFees: OmsOutboundActualFees = {
        lines: lines.map(l => ({
          type: l.type,
          label: l.label,
          amount: l.amount,
          detail: l.detail,
          chargeType: l.chargeType,
        })),
        actualTotal: total,
        calculatedAt: measuredAt,
      }
      remark = upsertOutboundActualFeesInRemark(
        upsertOutboundMeasureInRemark(remark, measure),
        actualFees,
      )
    }

    await this.prisma.outboundOrder.update({
      where: { id: BigInt(id) },
      data: {
        status: nextStatus,
        reviewerId: operatorId ? BigInt(operatorId) : order.reviewerId,
        reviewedAt: new Date(),
        reviewSource,
        isPalletized: payload?.isPalletized ?? order.isPalletized,
        palletInfo: payload?.palletInfo?.trim() || order.palletInfo,
        remark,
      },
    })
    return this.detail(id)
  }

  async setAppointment(id: number, payload: { appointmentStatus?: string; appointmentDate?: string | null }) {
    const order = await this.prisma.outboundOrder.findUnique({ where: { id: BigInt(id) } })
    if (!order) throw new NotFoundException('出库单不存在')
    if (order.status === 'cancelled') throw new BadRequestException('已取消单不可预约')

    const appointmentDate =
      payload.appointmentDate === null
        ? null
        : payload.appointmentDate !== undefined
          ? parseWorkDate(payload.appointmentDate)
          : undefined
    if (payload.appointmentDate !== undefined && payload.appointmentDate !== null && !appointmentDate) {
      throw new BadRequestException('预约送仓日期格式无效，请使用 YYYY-MM-DD')
    }

    let status = payload.appointmentStatus?.trim()
    if (!status) {
      if (appointmentDate) status = 'scheduled'
      else throw new BadRequestException('请选择预约状态或填写预约送仓日期')
    }
    if (appointmentDate && status === 'none') status = 'scheduled'

    await this.prisma.outboundOrder.update({
      where: { id: BigInt(id) },
      data: {
        appointmentStatus: status,
        ...(payload.appointmentDate !== undefined ? { appointmentDate } : {}),
      },
    })
    return this.detail(id)
  }

  async deliver(id: number, payload?: { podCode?: string; outcome?: string }) {
    const order = await this.prisma.outboundOrder.findUnique({ where: { id: BigInt(id) } })
    if (!order) throw new NotFoundException('出库单不存在')
    const outcome = parseDeliveryOutcome(payload?.outcome)
    if (!outcome) throw new BadRequestException('派送结果无效，请使用已送达、部分签收或派送失败')
    if (!canApplyDeliveryOutcome(order.status, outcome)) {
      throw new BadRequestException(
        order.status === outcome
          ? '出库单已是该派送状态'
          : '仅已发运、部分签收或派送失败的出库单可更新派送结果',
      )
    }
    await this.prisma.outboundOrder.update({
      where: { id: BigInt(id) },
      data: {
        status: outcome,
        deliveredAt: outcome === 'delivery_failed' ? order.deliveredAt : new Date(),
        podCode: payload?.podCode?.trim().slice(0, 80) || undefined,
      },
    })
    const detail = await this.detail(id)
    await this.pushOutboundStatusToOms(order.outboundNo)
    return detail
  }

  async ship(id: number, operatorId?: number, payload?: { trackingNo?: string; carrier?: string; logisticsProduct?: string }) {
    const order = await this.prisma.outboundOrder.findUnique({
      where: { id: BigInt(id) },
      include: { items: true, pickAllocations: true },
    })
    if (!order) throw new NotFoundException('出库单不存在')
    if (order.status === 'exception') throw new BadRequestException('异常单已暂停流程，请先解除异常')
    if (order.status !== 'packed') throw new BadRequestException('当前状态不可发运')

    await this.prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        const pickQty = item.pickedQty || item.qty
        await this.inventoryMutation.shipDeductWarehouse(tx, {
          productId: item.productId,
          sku: item.sku,
          warehouseCode: order.warehouseCode,
          qty: pickQty,
          referenceNo: order.outboundNo,
          operatorId,
          remark: item.locationCode ? `库位 ${item.locationCode}` : undefined,
        })

        // 新拣货流程已在确认拣货时扣减库位库存；这里只为历史订单保留兼容逻辑。
        if (!order.pickAllocations.length && item.locationCode) {
          const loc = await tx.warehouseLocation.findFirst({
            where: { warehouseCode: order.warehouseCode, locationCode: item.locationCode },
          })
          if (loc) {
            const invLoc = await tx.inventoryLocation.findFirst({
              where: { locationId: loc.id, sku: item.sku },
            })
            if (invLoc) {
              const after = invLoc.qty - pickQty
              if (after <= 0) {
                await tx.inventoryLocation.delete({ where: { id: invLoc.id } })
              } else {
                await tx.inventoryLocation.update({
                  where: { id: invLoc.id },
                  data: { qty: after },
                })
              }
            }
          }
        }
      }

      if (order.pickAllocations.length) {
        await tx.outboundPickAllocation.updateMany({
          where: { outboundId: order.id, status: 'picked' },
          data: { status: 'shipped', shippedAt: new Date() },
        })
      }

      const transitioned = await tx.outboundOrder.updateMany({
        where: { id: BigInt(id), status: 'packed' },
        data: {
          status: 'shipped',
          shippedAt: new Date(),
          trackingNo: payload?.trackingNo?.trim() || order.trackingNo || undefined,
          carrier: payload?.carrier?.trim() || order.carrier || undefined,
          logisticsProduct: payload?.logisticsProduct?.trim() || order.logisticsProduct || undefined,
        },
      })
      if (transitioned.count !== 1) {
        throw new BadRequestException('出库单状态已变化，发运操作已回滚，请刷新后重试')
      }
    })

    const shipCharges = await this.outboundBilling.recordShipCharges(order)

    const detail = await this.detail(id)
    await this.pushOutboundStatusToOms(order.outboundNo)
    if (shipCharges.length) {
      await this.pushOutboundFeesToOms(order.outboundNo, shipCharges)
    }
    return detail
  }

  async cancel(id: number) {
    const order = await this.prisma.outboundOrder.findUnique({
      where: { id: BigInt(id) },
      include: { items: true, pickAllocations: true },
    })
    if (!order) throw new NotFoundException('出库单不存在')
    if (isPostShipStatus(order.status)) throw new BadRequestException('已发运不可取消')
    if (order.status === 'cancelled') throw new BadRequestException('出库单已取消')
    const stockSource = parseStockSourceFromRemark(order.remark)
    const preDeduct = parseOmsOutboundPreDeduct(order.remark)
    const preDeductTotal = Math.max(0, Number(preDeduct?.preDeductTotal) || 0)

    await this.prisma.$transaction(async (tx) => {
      if (
        ['pending_pick', 'picking', 'picked', 'reviewing', 'pending_relabel', 'packed', 'exception'].includes(
          order.status,
        )
      ) {
        for (const item of order.items) {
          const inv = await tx.inventory.findUnique({
            where: {
              productId_warehouseCode: { productId: item.productId, warehouseCode: order.warehouseCode },
            },
          })
          if (inv) {
            await tx.inventory.update({
              where: { id: inv.id },
              data: {
                availableQty: inv.availableQty + item.qty,
                lockedQty: Math.max(0, inv.lockedQty - item.qty),
              },
            })
          }
          if (stockSource === 'catalog' && order.customerId) {
            const restored = await tx.customerSkuInventory.updateMany({
              where: { customerId: order.customerId, sku: item.sku },
              data: { quantity: { increment: item.qty } },
            })
            if (restored.count === 0) {
              await tx.customerSkuInventory.create({
                data: {
                  customerId: order.customerId,
                  sku: item.sku,
                  productName: item.productName || item.sku,
                  quantity: item.qty,
                },
              })
            }
          }
        }
      }
      // 拣货确认时已扣减库位库存；取消未发运订单时按实际拣货分配原路回补。
      for (const allocation of order.pickAllocations.filter((row) => row.status === 'picked')) {
        await this.inventoryMutation.restoreLocationQty(tx, {
          productId: allocation.productId,
          sku: allocation.sku,
          warehouseCode: allocation.warehouseCode,
          locationId: allocation.locationId,
          locationCode: allocation.locationCode,
          inventoryLocationId: allocation.inventoryLocationId,
          qty: allocation.qty,
        })
      }
      if (order.pickAllocations.length) {
        await tx.outboundPickAllocation.updateMany({
          where: { outboundId: order.id, status: 'picked' },
          data: { status: 'cancelled', cancelledAt: new Date() },
        })
      }
      if (preDeductTotal > 0 && order.customerId) {
        await tx.customer.update({
          where: { id: order.customerId },
          data: { balance: { increment: preDeductTotal } },
        })
      }
      const transitioned = await tx.outboundOrder.updateMany({
        where: { id: BigInt(id), status: order.status },
        data: { status: 'cancelled' },
      })
      if (transitioned.count !== 1) {
        throw new BadRequestException('出库单状态已变化，取消操作已回滚，请刷新后重试')
      }
    })
    await this.pushOutboundStatusToOms(order.outboundNo)
    if (preDeductTotal > 0) {
      await this.pushOutboundRefundToOms(order.outboundNo, preDeductTotal)
    }
    return this.detail(id)
  }

  // ───────────── OMS P1：客户预约出库 / 物流回写 ─────────────

  /** 把已有出库状态再推给 OMS（只发 outbound.status，不重放库存/退款）。 */
  async replayOmsStatuses(): Promise<{ outboundNo: string; omsStatus: string; ok: boolean }[]> {
    const rows = await this.prisma.outboundOrder.findMany({
      where: { customerId: { not: null } },
      select: { outboundNo: true },
      orderBy: { id: 'asc' },
    })
    const out: { outboundNo: string; omsStatus: string; ok: boolean }[] = []
    for (const row of rows) {
      const mapped = await this.getByOutboundNoForOms(row.outboundNo)
      if (!mapped.customerCode) continue
      const ok = await notifyOms(
        'outbound.status',
        mapped.customerCode,
        mapped as unknown as Record<string, unknown>,
      )
      out.push({ outboundNo: mapped.outboundNo, omsStatus: String(mapped.omsStatus), ok })
    }
    return out
  }

  private mapOutboundForOms(order: {
    id: bigint | number
    outboundNo: string
    customerId: bigint | null
    warehouseCode: string
    status: string
    trackingNo: string | null
    carrier: string | null
    logisticsProduct: string | null
    platform: string | null
    remark: string | null
    fbaNo: string | null
    fbaWarehouse: string | null
    sellerStoreName: string | null
    takealotSellerId: string | null
    takealotBookingRef: string | null
    recipientJson: string | null
    shipmentDueDate: Date | null
    appointmentDate: Date | null
    shippedAt: Date | null
    deliveredAt: Date | null
    podCode: string | null
    createdAt: Date
    updatedAt: Date
    items?: { sku: string; productName: string | null; qty: number; productId: bigint }[]
    attachments?: any[]
    customerName?: string | null
    customerCode?: string | null
  }) {
    const meta = parseOmsOutboundMeta(order.remark)
    const preDeduct = parseOmsOutboundPreDeduct(order.remark)
    const measure = parseOmsOutboundMeasure(order.remark)
    const actualFees = parseOmsOutboundActualFees(order.remark)
    const stockSource = parseStockSourceFromRemark(order.remark)
    const destination =
      meta.destination ||
      outboundDestinationLabel({
        fbaWarehouse: order.fbaWarehouse,
        platform: order.platform,
        destType: (order as { destType?: string }).destType,
      })
    return {
      id: Number(order.id),
      outboundNo: order.outboundNo,
      customerId: order.customerId ? Number(order.customerId) : null,
      customerCode: order.customerCode ?? null,
      customerName: order.customerName ?? null,
      warehouseCode: order.warehouseCode,
      status: order.status,
      omsStatus: toOmsOutboundStatus(order.status),
      trackingNo: order.trackingNo,
      carrier: order.carrier,
      logisticsProduct: order.logisticsProduct,
      shippingMethod: meta.shippingMethod || order.logisticsProduct,
      platform: order.platform,
      fbaNo: order.fbaNo,
      fbaWarehouse: order.fbaWarehouse,
      destination,
      source: meta.source || null,
      orderNo: meta.orderNo || null,
      destRegion: preDeduct?.destRegion || meta.destRegion || null,
      preDeduct: preDeduct || null,
      measure: measure || null,
      actualFees: actualFees || null,
      stockSource: stockSource || 'catalog',
      sellerStoreName: order.sellerStoreName,
      takealotSellerId: order.takealotSellerId,
      takealotBookingRef: order.takealotBookingRef,
      recipient: parseRecipient(order.recipientJson),
      shipmentDueDate: formatWorkDate(order.shipmentDueDate),
      remark: stripOmsSystemTags(order.remark),
      appointmentDate: formatWorkDate(order.appointmentDate),
      shippedAt: order.shippedAt,
      deliveredAt: order.deliveredAt,
      podCode: order.podCode,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      attachments: this.mapAttachments(order.attachments || []),
      items: (order.items || []).map((i) => ({
        sku: i.sku,
        productName: i.productName,
        qty: i.qty,
        productId: Number(i.productId),
      })),
    }
  }

  /** OMS：预约出库（锁仓存；货盘来源额外扣减客户持有量） */
  async createFromOms(data: CreateOmsOutboundDto) {
    const lines = Array.isArray(data.items) ? data.items : []
    if (!lines.length) throw new BadRequestException('请添加出库明细')
    const normalizedAttachments = this.normalizeAttachmentInputs(data.attachments)
    try {
      assertSkuLabelCounts(lines, normalizedAttachments)
    } catch (error) {
      if (error instanceof OutboundLabelValidationError) {
        throw new BadRequestException(error.message)
      }
      throw error
    }

    const customerCode = String(data.customerCode || '').trim()
    if (!customerCode) throw new BadRequestException('缺少客户编码 customerCode')
    const customer = await this.prisma.customer.findUnique({ where: { customerCode } })
    if (!customer) throw new NotFoundException(`客户代码 ${customerCode} 不存在`)
    if (customer.status !== 1) throw new BadRequestException('客户已停用')

    const outboundNo = String(data.outboundNo || '').trim() || `OUT-OMS-${Date.now().toString().slice(-8)}`
    if (outboundNo.length > 30) {
      throw new BadRequestException(`出库单号最长 30 字符，当前 ${outboundNo.length} 字符`)
    }
    const existing = await this.prisma.outboundOrder.findUnique({
      where: { outboundNo },
      include: { items: true, attachments: { orderBy: { id: 'asc' } } },
    })
    if (existing) {
      const incomingPayload = idempotencyPayload({
        customerCode,
        warehouseCode: data.warehouseCode,
        stockSource: data.stockSource,
        items: data.items,
        preDeductTotal: data.preDeduct?.preDeductTotal,
        recipient: data.recipient ? normalizeRecipient(data.recipient) : null,
      })
      const existingPayload = idempotencyPayload({
        customerCode,
        warehouseCode: existing.warehouseCode,
        stockSource: parseStockSourceFromRemark(existing.remark) ?? undefined,
        items: existing.items,
        preDeductTotal: parseOmsOutboundPreDeduct(existing.remark)?.preDeductTotal,
        recipient: parseRecipient(existing.recipientJson),
      })
      if (incomingPayload !== existingPayload) {
        throw new ConflictException(`出库单号 ${outboundNo} 已存在，但请求载荷不一致`)
      }
      return {
        ...this.mapOutboundForOms({
          ...existing,
          customerCode,
          customerName: customer.customerName,
        }),
        idempotent: true,
      }
    }

    const warehouseCode = String(data.warehouseCode || 'WMS-JHB-01').trim()
    const stockSource = data.stockSource === 'owned' ? 'owned' : 'catalog'
    const destType =
      data.destType ||
      (data.platform === 'Takealot' ? 'fba' : data.fbaWarehouse ? 'fba' : 'local')
    const shippingMethod = data.shippingMethod?.trim() || undefined
    const preDeduct = data.preDeduct && Array.isArray(data.preDeduct.lines) && data.preDeduct.lines.length
      ? {
          destRegion: data.preDeduct.destRegion?.trim() || undefined,
          priceTemplateId: data.preDeduct.priceTemplateId?.trim() || undefined,
          priceTemplateName: data.preDeduct.priceTemplateName?.trim() || undefined,
          preDeductTotal: Number(data.preDeduct.preDeductTotal) || 0,
          totalVolumeM3: data.preDeduct.totalVolumeM3,
          totalWeightKg: data.preDeduct.totalWeightKg,
          lines: data.preDeduct.lines.map(l => ({
            type: String(l.type || ''),
            label: String(l.label || ''),
            amount: Number(l.amount) || 0,
            detail: l.detail ? String(l.detail) : undefined,
          })),
          deductedAt: data.preDeduct.deductedAt?.trim() || undefined,
          templateSnapshot: data.preDeduct.templateSnapshot,
        }
      : null
    const preDeductTotal = Math.max(0, Number(preDeduct?.preDeductTotal) || 0)
    if (preDeductTotal > Number(customer.balance)) {
      throw new BadRequestException(
        `客户余额不足：需预扣 ¥${preDeductTotal.toFixed(2)}，当前余额 ¥${Number(customer.balance).toFixed(2)}`,
      )
    }
    const remark = buildOutboundRemark({
      customerCode,
      stockSource,
      userRemark: data.remark,
      meta: {
        destination: data.destination?.trim(),
        shippingMethod,
        source: data.source?.trim(),
        orderNo: data.orderNo?.trim(),
        destRegion: preDeduct?.destRegion,
      },
      preDeduct,
    })
    const resolved: { productId: bigint; sku: string; qty: number; productName: string }[] = []
    for (const line of lines) {
      const sku = String(line.sku || '').trim()
      const qty = Math.floor(Number(line.qty ?? 0))
      if (!sku || qty <= 0) throw new BadRequestException('SKU 与出库数量无效')
      const product = await this.prisma.product.findUnique({ where: { sku } })
      if (!product) throw new NotFoundException(`SKU ${sku} 不存在，请先完成入库建档`)
      resolved.push({
        productId: product.id,
        sku: product.sku,
        qty,
        productName: line.productName || product.productName,
      })
    }

    if (stockSource === 'catalog') {
      for (const line of resolved) {
        const holding = await this.prisma.customerSkuInventory.findUnique({
          where: { customerId_sku: { customerId: customer.id, sku: line.sku } },
        })
        if (!holding || holding.quantity < line.qty) {
          throw new BadRequestException(
            `客户持有库存不足：${line.sku} 持有 ${holding?.quantity ?? 0}，需要 ${line.qty}（请先货盘申购）`,
          )
        }
      }
    }

    const { created, fresh } = await this.prisma.$transaction(async (tx) => {
      const created = await this.create(
        {
          outboundNo,
          warehouseCode,
          customerId: Number(customer.id),
          destType,
          platform: data.platform,
          fbaNo: data.fbaNo?.trim() || data.poNumber?.trim() || undefined,
          fbaWarehouse: data.fbaWarehouse,
          sellerStoreName: data.sellerStoreName?.trim() || undefined,
          takealotSellerId: data.takealotSellerId?.trim() || undefined,
          takealotBookingRef: data.takealotBookingRef?.trim() || undefined,
          shipmentDueDate: data.shipmentDueDate,
          appointmentDate: data.appointmentDate,
          logisticsProduct: shippingMethod,
          remark,
          recipient: data.recipient,
          needsRelabel: true,
          items: resolved.map((l) => ({
            productId: Number(l.productId),
            sku: l.sku,
            productName: l.productName,
            qty: l.qty,
          })),
          attachments: normalizedAttachments,
        },
        undefined,
        tx,
      )

      if (stockSource === 'catalog') {
        for (const line of resolved) {
          const holding = await tx.customerSkuInventory.findUnique({
            where: { customerId_sku: { customerId: customer.id, sku: line.sku } },
          })
          if (!holding || holding.quantity < line.qty) {
            throw new BadRequestException(
              `客户持有库存不足：${line.sku} 持有 ${holding?.quantity ?? 0}，需要 ${line.qty}`,
            )
          }
          await tx.customerSkuInventory.update({
            where: { id: holding.id },
            data: { quantity: { decrement: line.qty } },
          })
        }
      }
      if (preDeductTotal > 0) {
        const debited = await tx.customer.updateMany({
          where: {
            id: customer.id,
            status: 1,
            balance: { gte: preDeductTotal },
          },
          data: { balance: { decrement: preDeductTotal } },
        })
        if (debited.count !== 1) {
          throw new BadRequestException(
            `客户余额不足：需预扣 ¥${preDeductTotal.toFixed(2)}，当前余额 ¥${Number(customer.balance).toFixed(2)}`,
          )
        }
      }
      if (preDeduct?.lines?.length) {
        await this.billing.recordOutboundCharges({
          customerId: Number(customer.id),
          outboundNo,
          warehouseCode,
          source: 'erp',
          lines: preDeduct.lines,
        }, tx)
      }

      const fresh = await tx.outboundOrder.findUnique({
        where: { outboundNo },
        include: { items: true, attachments: { orderBy: { id: 'asc' } } },
      })
      return { created, fresh }
    }, { timeout: 20000 })

    return {
      ...this.mapOutboundForOms({
        ...fresh!,
        customerCode,
        customerName: customer.customerName,
      }),
      idempotent: false,
      erpId: created?.id ?? Number(fresh!.id),
    }
  }

  async listByOmsCustomer(customerCode: string) {
    const code = customerCode.trim()
    if (!code) throw new BadRequestException('缺少客户编码')
    const customer = await this.prisma.customer.findUnique({ where: { customerCode: code } })
    if (!customer) throw new NotFoundException(`客户代码 ${code} 不存在`)
    const rows = await this.prisma.outboundOrder.findMany({
      where: { customerId: customer.id },
      include: { items: true, attachments: { orderBy: { id: 'asc' } } },
      orderBy: { id: 'desc' },
      take: 200,
    })
    return {
      items: rows.map((r) =>
        this.mapOutboundForOms({
          ...r,
          customerCode: code,
          customerName: customer.customerName,
        }),
      ),
      total: rows.length,
    }
  }

  /** OMS：按 SKU 查客户出库单（含明细数量与状态） */
  async listSkuOutboundsForOms(customerCode: string, sku: string) {
    const code = customerCode.trim()
    const skuCode = sku.trim()
    if (!code) throw new BadRequestException('缺少客户编码')
    if (!skuCode) throw new BadRequestException('缺少 SKU')
    const customer = await this.prisma.customer.findUnique({ where: { customerCode: code } })
    if (!customer) throw new NotFoundException(`客户代码 ${code} 不存在`)

    const rows = await this.prisma.outboundOrder.findMany({
      where: {
        customerId: customer.id,
        items: { some: { sku: skuCode } },
      },
      include: { items: true, attachments: { orderBy: { id: 'asc' } } },
      orderBy: { id: 'desc' },
      take: 100,
    })

    return {
      items: rows.map((o) => {
        const line = o.items.find((i) => i.sku === skuCode)
        const omsStatus = toOmsOutboundStatus(o.status)
        return {
          outboundNo: o.outboundNo,
          outboundId: Number(o.id),
          sku: skuCode,
          qty: line?.pickedQty || line?.qty || 0,
          status: o.status,
          omsStatus,
          statusLabel: OUTBOUND_STATUS_LABELS[o.status] || omsStatus,
          refNo: o.fbaNo || null,
          fbaNo: o.fbaNo,
          fbaWarehouse: o.fbaWarehouse,
          warehouseCode: o.warehouseCode,
          destination: o.fbaWarehouse || o.destType?.toUpperCase() || '',
          platform: o.platform,
          trackingNo: o.trackingNo,
          appointmentDate: formatWorkDate(o.appointmentDate),
          attachments: this.mapAttachments(
            o.attachments.filter((attachment) => attachment.sku === skuCode),
          ),
          createdAt: o.createdAt,
          shippedAt: o.shippedAt,
          deliveredAt: o.deliveredAt,
        }
      }),
      total: rows.length,
    }
  }

  async getByOutboundNoForOms(outboundNo: string) {
    const no = outboundNo.trim()
    const row = await this.prisma.outboundOrder.findUnique({
      where: { outboundNo: no },
      include: { items: true, attachments: { orderBy: { id: 'asc' } } },
    })
    if (!row) throw new NotFoundException(`出库单 ${no} 不存在`)
    let customerCode: string | null = null
    let customerName: string | null = null
    if (row.customerId) {
      const c = await this.prisma.customer.findUnique({ where: { id: row.customerId } })
      customerCode = c?.customerCode ?? null
      customerName = c?.customerName ?? null
    }
    return this.mapOutboundForOms({ ...row, customerCode, customerName })
  }

  /** OMS：下载 POD 签收单 */
  async downloadPodForOms(outboundNo: string, customerCode: string) {
    const no = String(outboundNo || '').trim()
    const code = String(customerCode || '').trim()
    if (!code) throw new BadRequestException('缺少 customerCode')
    const order = await this.prisma.outboundOrder.findUnique({
      where: { outboundNo: no },
      include: {
        attachments: { where: { fileType: 'pod' }, orderBy: { id: 'desc' }, take: 1 },
      },
    })
    if (!order) throw new NotFoundException(`出库单 ${no} 不存在`)
    const customer = await this.prisma.customer.findUnique({
      where: { customerCode: code },
    })
    if (!customer || order.customerId !== customer.id) {
      throw new BadRequestException('客户编码与出库单不匹配')
    }
    const att = order.attachments[0]
    if (!att) throw new NotFoundException('该出库单暂无 POD 签收单')
    if (!att.filePath || !this.files.exists(att.filePath)) {
      throw new NotFoundException('POD 签收单文件不存在，可能未同步到本机或已被清理')
    }
    return { fileName: att.fileName, content: this.files.read(att.filePath) }
  }

  /** OMS：客户回传 POD 签收单（PDF/图片） */
  async uploadPodFromOms(
    outboundNo: string,
    data: { customerCode: string; fileName: string; contentBase64: string },
  ) {
    const no = String(outboundNo || '').trim()
    const customerCode = String(data.customerCode || '').trim()
    if (!no) throw new BadRequestException('缺少 outboundNo')
    if (!customerCode) throw new BadRequestException('缺少 customerCode')
    if (!data.fileName?.trim() || !data.contentBase64) {
      throw new BadRequestException('请提供 POD 文件名与内容')
    }
    const order = await this.prisma.outboundOrder.findUnique({ where: { outboundNo: no } })
    if (!order) throw new NotFoundException(`出库单 ${no} 不存在`)
    if (!order.customerId) throw new BadRequestException('出库单未绑定客户')
    const customer = await this.prisma.customer.findUnique({ where: { id: order.customerId } })
    if (!customer || customer.customerCode !== customerCode) {
      throw new BadRequestException('客户编码与出库单不匹配')
    }
    const saved = this.writeAttachment(data.fileName.trim(), data.contentBase64)
    await this.prisma.outboundAttachment.create({
      data: {
        outboundId: order.id,
        fileType: 'pod',
        fileName: saved.attachmentName,
        filePath: saved.attachmentPath,
        contentHash: saved.contentHash,
      },
    })
    await this.pushOutboundStatusToOms(no)
    return this.getByOutboundNoForOms(no)
  }

  private async resolvePodStatus(order: {
    id: bigint
    status: string
    podCode: string | null
  }): Promise<'uploaded' | 'pending' | 'not_required'> {
    if (order.status === 'shipped' || order.status === 'exception') return 'pending'
    if (order.status === 'delivered') {
      if (order.podCode) return 'uploaded'
      const podAtt = await this.prisma.outboundAttachment.findFirst({
        where: { outboundId: order.id, fileType: 'pod' },
      })
      return podAtt ? 'uploaded' : 'pending'
    }
    return 'not_required'
  }

  private async pushOutboundFeesToOms(
    outboundNo: string,
    charges: Array<{
      chargeNo: string
      id?: number
      chargeType: string
      amount: number
      description: string
      bizRef?: string | null
    }>,
  ) {
    try {
      const mapped = await this.getByOutboundNoForOms(outboundNo)
      if (!mapped.customerCode) return
      const row = await this.prisma.outboundOrder.findUnique({ where: { outboundNo } })
      const customer = row?.customerId
        ? await this.prisma.customer.findUnique({ where: { id: row.customerId } })
        : null
      void notifyOms('outbound.fees', mapped.customerCode, {
        outboundNo,
        preDeduct: mapped.preDeduct,
        actualFees: mapped.actualFees,
        measure: mapped.measure,
        charges,
        balance: customer ? Number(customer.balance) : null,
        status: mapped.omsStatus,
      })
    } catch (err) {
      console.warn('[outbound] push fees to OMS skipped:', err)
    }
  }

  private async pushOutboundRefundToOms(outboundNo: string, preDeductTotal: number) {
    try {
      const mapped = await this.getByOutboundNoForOms(outboundNo)
      if (!mapped.customerCode) return
      const row = await this.prisma.outboundOrder.findUnique({ where: { outboundNo } })
      const customer = row?.customerId
        ? await this.prisma.customer.findUnique({ where: { id: row.customerId } })
        : null
      void notifyOms('outbound.refund', mapped.customerCode, {
        outboundNo,
        preDeductTotal,
        balance: customer ? Number(customer.balance) : null,
        reason: 'cancelled',
      })
    } catch (err) {
      console.warn('[outbound] push refund to OMS skipped:', err)
    }
  }

  private async pushOutboundStatusToOms(outboundNo: string) {
    try {
      const mapped = await this.getByOutboundNoForOms(outboundNo)
      if (!mapped.customerCode) return
      void notifyOms(
        'outbound.status',
        mapped.customerCode,
        mapped as unknown as Record<string, unknown>,
      )
      if (isPostShipStatus(mapped.status) || mapped.status === 'exception') {
        const row = await this.prisma.outboundOrder.findUnique({
          where: { outboundNo },
          include: { attachments: { where: { fileType: 'pod' }, orderBy: { id: 'desc' }, take: 1 } },
        })
        const podAtt = row?.attachments[0]
        const podStatus = row ? await this.resolvePodStatus(row) : 'pending'
        void notifyOms('logistics.update', mapped.customerCode, {
          id: `lg-erp-${mapped.id}`,
          refNo: mapped.outboundNo,
          outboundNo: mapped.outboundNo,
          carrier: mapped.carrier || mapped.logisticsProduct || '—',
          trackingNo: mapped.trackingNo || '—',
          status: toOmsLogisticsStatus(mapped.status),
          destination: mapped.platform || '—',
          updatedAt: new Date().toISOString(),
          podStatus,
          podCode: mapped.podCode,
          podFileName: podAtt?.fileName ?? null,
          podUploadedAt: podAtt?.createdAt.toISOString() ?? null,
          shippedAt: mapped.shippedAt,
          deliveredAt: mapped.deliveredAt,
        })
      }
      if (mapped.status === 'shipped' || mapped.status === 'cancelled') {
        void notifyOms('inventory.changed', mapped.customerCode, {
          reason: 'outbound_' + mapped.status,
          outboundNo: mapped.outboundNo,
          stockSource: mapped.stockSource,
          items: mapped.items,
        })
      }
    } catch (err) {
      console.warn('[outbound] push OMS skipped:', err)
    }
  }

  /** OMS：客户维度物流轨迹（已发运/已送达） */
  async listLogisticsByOmsCustomer(customerCode: string) {
    const code = customerCode.trim()
    const customer = await this.prisma.customer.findUnique({ where: { customerCode: code } })
    if (!customer) throw new NotFoundException(`客户代码 ${code} 不存在`)
    const rows = await this.prisma.outboundOrder.findMany({
      where: {
        customerId: customer.id,
        status: { in: ['shipped', 'delivered', 'partial_delivered', 'delivery_failed', 'exception'] },
      },
      include: { attachments: { where: { fileType: 'pod' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })
    return {
      items: await Promise.all(rows.map(async (r) => {
        const podAtt = r.attachments[0]
        return {
        id: `lg-erp-${Number(r.id)}`,
        refNo: r.fbaNo || r.outboundNo,
        outboundNo: r.outboundNo,
        carrier: r.carrier || r.logisticsProduct || '—',
        trackingNo: r.trackingNo || '—',
        status: toOmsLogisticsStatus(r.status),
        destination: r.fbaWarehouse || r.platform || r.destType || '—',
        updatedAt: (r.deliveredAt || r.shippedAt || r.updatedAt).toISOString(),
        podStatus: await this.resolvePodStatus(r),
        podCode: r.podCode,
        podFileName: podAtt?.fileName ?? null,
        podUploadedAt: podAtt?.createdAt.toISOString() ?? null,
        shippedAt: r.shippedAt,
        deliveredAt: r.deliveredAt,
        exceptionReason: r.problemRemark,
      }})),
      total: rows.length,
    }
  }
}
