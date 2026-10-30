import { readErpShipmentOutcome } from './erp-shipment-outcome.util'
import { assertGlobalSkuAvailable } from '../../common/global-sku.util'
import { isCatalogPurchaseInbound } from './catalog-inbound.util'
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import { ApplyShipmentFreightDto, CreateErpShipmentDto, ShipmentFreightMutationDto } from './dto/erp-shipment.dto'
import { removeErpShipment, writeErpShipmentFreight } from './erp-shipment-maintenance.util'
import { shipmentSeaFreightVersion } from './erp-shipment-edit.util'
import { runInboundReceiving } from './inbound-receiving-transaction.util'
import { runInboundPutaway } from './inbound-putaway-transaction.util'
import { runInboundControl, InboundControlKind } from './inbound-control-transaction.util'
import { InboundControlDto } from './dto/inbound-control.dto'
import { attachInboundWorkflowRevision } from './inbound-workflow-revision.util'
import { PutawayInboundDto } from './dto/inbound-putaway.dto'
import { pushCatalogStockToOms } from '../pricing/oms-catalog-sync.util'
import { inboundMeasurementVersion, inboundReceivingVersion } from './inbound-receiving-version.util'
import { inboundCartonReadiness } from './inbound-carton-readiness.util'
import { MeasureInboundDto, RecordInboundCartonsDto, ScanInboundCartonDto, ScanInboundQcDto, SubmitInboundQcDto } from './dto/inbound-receiving.dto'
import { erpShipmentFingerprint, erpShipmentRequest } from './erp-shipment-request.util'
import { ERP_MASTER_PRODUCT_WHERE } from '../../common/product-source.util'
import { syncCatalogFromInbound } from '../pricing/catalog-sync.util'
import { PrismaService } from '../../common/prisma/prisma.service'
import { FileStoreService } from '../../common/file-store.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { OperationLogService } from '../operation-log/operation-log.service'
import { tryMarkOrderableOnOmsForSkus } from '../pricing/oms-catalog.util'
import { PricingService } from '../pricing/pricing.service'
import { notifyOms } from '../../common/oms-notify.util'
import { fetchOmsInboundRows, mergeInboundPaginate } from './oms-inbound-bridge.util'
import { buildInboundRemark, parseOmsInboundMeta, stripOmsSystemTags } from '../../common/oms-sync-meta.util'
import { resolveBillingDimensions } from '../../common/product-dimension.util'
import { findInboundItemByScan as matchInboundItemByScan } from './inbound-item-scan.util'
import { loadPlatformBarcodesByInternalSku, productScanFields } from '../../common/platform-barcode-lookup.util'
import { InventoryMutationService } from '../../common/inventory/inventory-mutation.service'
import { buildInternalSku, deriveCustomerCodeFromInternalSku } from '../../common/sku-code.util'
import { buildBoxLabelsPdfBuffer, buildInboundBoxLabelData } from '../../common/labels/box-label-pdf.util'
import { buildSkuLabelsHtml, buildSkuLabelsPdfBuffer } from '../../common/labels/sku-label.util'
import { inboundCustomerSku } from '@erp/shared/inbound-customer-sku'
import { InboundFeeService } from './inbound-fee.service'
import { normalizeOmsAsnCustomerDimensions } from './oms-asn-dimensions.util'
import {
  buildInboundReceivingListHtml,
  formatInboundListDateTime,
  groupReceivingListSkus,
  printInboundWarehouseCode,
} from '@erp/shared/inbound-receiving-list'
import {
  buildCartonCode,
  buildInboundNo,
  inboundNoFromScan,
  inboundNoPrefix,
  matchCartonByScan,
  nextSeqFromNos,
} from '@erp/shared/wms-doc-no'

type OmsAsnLineInput = {
  sku: string
  qty: number
  productName?: string
  boxNo?: number
  lengthCm?: number
  widthCm?: number
  heightCm?: number
}

/** 在途，等待到仓扫描 */
const PENDING_RECEIPT_STATUSES = new Set([
  'pending_receipt',
  'pending_push',
  'push_failed',
  'pushed',
])

/** 可开始收货 / 提交清点 */
const QC_STATUSES = new Set(['arrived', 'receiving'])

/** 可上架 */
const PUTAWAY_STATUSES = new Set(['pending_putaway'])

const TERMINAL_STATUSES = new Set(['completed', 'confirmed', 'cancelled'])

function inboundStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    oms_draft: '未提交草稿', pending_receipt: '在途', pending_push: '在途',
    push_failed: '在途', pushed: '在途', arrived: '已到仓', receiving: '收货中',
    pending_putaway: '待上架', completed: '已入库', confirmed: '已入库',
    exception: '异常', cancelled: '作废',
  }
  return labels[status] || '暂无法识别，请刷新核对'
}

function pieceQty(items: Array<{ actualQty?: number | null; expectedQty?: number; putawayQty?: number | null }>, field?: 'putawayQty') {
  return (items || []).reduce((sum, item) => {
    if (field === 'putawayQty') return sum + Number(item.putawayQty ?? item.actualQty ?? item.expectedQty ?? 0)
    return sum + Number(item.actualQty ?? item.expectedQty ?? 0)
  }, 0)
}

/** 旧 WMS 推送态 → 当前流程展示态 */
function normalizeInboundStatus(status: string): string {
  if (PENDING_RECEIPT_STATUSES.has(status)) return 'pending_receipt'
  if (status === 'confirmed') return 'completed'
  return status
}

@Injectable()
export class InboundService {
  constructor(
    private prisma: PrismaService,
    private files: FileStoreService,
    private opLog: OperationLogService,
    private pricing: PricingService,
    private inventoryMutation: InventoryMutationService,
    private inboundFee: InboundFeeService,
  ) {}

  async list(q: PaginationDto & { status?: string; source?: string }) {
    const { page, pageSize } = getPagination(q)
    const where: any = {}
    if (q.source && !['all', 'erp_shipment', 'oms_customer'].includes(q.source)) {
      throw new BadRequestException('无效的入库单来源')
    }
    if (q.source === 'erp_shipment') {
      where.AND = [{ sourceWarehouseCode: { not: null } }, { sourceWarehouseCode: { not: '' } }]
    } else if (q.source === 'oms_customer') {
      where.omsCustomerCode = { not: null }
      where.AND = [{ OR: [{ sourceWarehouseCode: null }, { sourceWarehouseCode: '' }] }]
    }
    if (q.status && q.status !== 'all') {
      if (q.status === 'pending_receipt') {
        where.status = { in: [...PENDING_RECEIPT_STATUSES] }
      } else if (q.status === 'completed') {
        where.status = { in: ['completed', 'confirmed'] }
      } else {
        where.status = q.status
      }
    }
    if (q.keyword) {
      const kw = q.keyword.trim()
      where.OR = [
        { inboundNo: { contains: kw } },
        { warehouseNo: { contains: kw } },
        { trackingNo: { contains: kw } },
        { omsCustomerCode: { contains: kw } },
      ]
    }
    const rows = await this.prisma.inboundOrder.findMany({
      where,
      include: { items: true },
      orderBy: { id: 'desc' },
      take: 5000,
    })
    const productIds = [...new Set(rows.flatMap((r) => r.items.map((i) => i.productId)))]
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } } })
      : []
    const prodMap = new Map(products.map((p) => [Number(p.id), p]))
    const platformBySku = await this.loadPlatformScanIndex(rows.flatMap((r) => r.items), prodMap)
    const erpItems = rows.map((order) => ({
      ...order,
      id: Number(order.id),
      displayStatus: normalizeInboundStatus(order.status),
      dataSource: order.omsCustomerCode ? 'erp_oms' : 'erp',
      dataSourceLabel: order.omsCustomerCode ? 'ERP·OMS客户' : 'ERP·发运',
      readOnly: false,
      sourceKind: order.sourceWarehouseCode ? 'erp_shipment' : order.omsCustomerCode ? 'oms_customer' : 'erp_other',
      sortKey: order.createdAt.getTime(),
      items: order.items.map((item: any) => this.enrichInboundItem(item, prodMap, platformBySku)),
    }))

    const omsItems = q.source === 'erp_shipment' ? [] : await fetchOmsInboundRows(this.prisma, {
      keyword: q.keyword,
      status: q.status,
    })
    // Check ERP existence without the status filter: an OMS snapshot can lag behind
    // its ERP order and must not reappear under an earlier workflow status.
    const linkedErpOrders = omsItems.length
      ? await this.prisma.inboundOrder.findMany({
          where: { inboundNo: { in: omsItems.map((r) => r.inboundNo) } },
          select: { inboundNo: true },
        })
      : []
    const erpNoSet = new Set([
      ...erpItems.map((r) => r.inboundNo),
      ...linkedErpOrders.map((r) => r.inboundNo),
    ])
    const omsOnly = omsItems.filter((r) => !erpNoSet.has(r.inboundNo)).map(r => ({ ...r, sourceKind: 'oms_customer' }))

    const { items, total } = mergeInboundPaginate([erpItems, omsOnly], page, pageSize)
    return { items, total, page, pageSize }
  }

  async detail(id: number, options?: { reconcileCatalog?: boolean }) {
    const row = await this.prisma.inboundOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true, putawayItems: { orderBy: { id: 'desc' } } } })
    if (!row) throw new NotFoundException('入库单不存在')
    await attachInboundWorkflowRevision(this.prisma, row)

    const productIds = [...new Set(row.items.map((i) => i.productId))]
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } } })
      : []
    const prodMap = new Map(products.map((p) => [Number(p.id), p]))
    const platformBySku = await this.loadPlatformScanIndex(row.items, prodMap)

    const cartons = await this.loadCartons(Number(row.id), row.inboundNo, row.items)

    const displayStatus = normalizeInboundStatus(row.status)
    if (displayStatus === 'completed' && options?.reconcileCatalog !== false) {
      try {
        await this.pricing.applyInboundActual({
          inboundNo: row.inboundNo,
          lines: row.items.map((i) => ({
            sku: i.sku,
            actualQty: Number(i.actualQty ?? 0),
          })),
        })
      } catch (err) {
        console.warn('[inbound-detail] catalog actual qty sync skipped:', err)
      }
    }

    return {
      ...row,
      id: Number(row.id),
      displayStatus: normalizeInboundStatus(row.status),
      seaFreightVersion: shipmentSeaFreightVersion(row, products),
      receivingVersion: inboundReceivingVersion({ ...row, cartons }),
      measurementVersion: inboundMeasurementVersion({ ...row, cartons }, products),
      cartonConfirmation: await inboundCartonReadiness(this.prisma, { ...row, cartons }),
      items: row.items.map((item) => this.enrichInboundItem(item, prodMap, platformBySku)),
      cartons,
      omsAttachments: await this.loadOmsAttachments(Number(row.id)),
    }
  }

  private async loadOmsAttachments(inboundId: number) {
    const rows: { id: number; fileName: string }[] = await this.prisma.$queryRawUnsafe(
      'SELECT id, file_name as fileName FROM inbound_attachment WHERE inbound_id = ? ORDER BY id ASC',
      inboundId,
    )
    return rows.map(r => ({ id: Number(r.id), fileName: String(r.fileName) }))
  }

  async downloadStaffAttachment(inboundId: number, attachmentId: number) {
    const order = await this.prisma.inboundOrder.findUnique({ where: { id: BigInt(inboundId) } })
    if (!order) throw new NotFoundException('入库单不存在')
    const rows: { fileName: string; filePath: string }[] = await this.prisma.$queryRawUnsafe(
      'SELECT file_name as fileName, file_path as filePath FROM inbound_attachment WHERE id = ? AND inbound_id = ?',
      attachmentId,
      Number(order.id),
    )
    if (!rows.length) throw new NotFoundException('附件不存在')
    return { fileName: rows[0].fileName, content: this.files.read(rows[0].filePath) }
  }

  async downloadOmsAttachment(inboundNo: string, attachmentId: number, customerCode: string) {
    const code = String(customerCode || '').trim()
    if (!code) throw new BadRequestException('缺少客户代码')
    const order = await this.prisma.inboundOrder.findUnique({ where: { inboundNo: inboundNo.trim() } })
    if (!order) throw new NotFoundException('入库单不存在')
    if (!order.omsCustomerCode || order.omsCustomerCode !== code) {
      throw new BadRequestException('客户编码与入库单不匹配')
    }
    const rows: { fileName: string; filePath: string }[] = await this.prisma.$queryRawUnsafe(
      'SELECT file_name as fileName, file_path as filePath FROM inbound_attachment WHERE id = ? AND inbound_id = ?',
      attachmentId,
      Number(order.id),
    )
    if (!rows.length) throw new NotFoundException('附件不存在')
    return { fileName: rows[0].fileName, content: this.files.read(rows[0].filePath) }
  }

  private async loadCartons(
    inboundId: number,
    inboundNo: string,
    items: { id: bigint; productId: bigint; sku: string; expectedQty: number }[],
  ) {
    let rows = await this.prisma.inboundCarton.findMany({
      where: { inboundId: BigInt(inboundId) },
      include: { items: true },
      orderBy: { boxSeq: 'asc' },
    })
    if (!rows.length && items.length) {
      await this.persistCartons(this.prisma, { id: BigInt(inboundId), inboundNo, items })
      rows = await this.prisma.inboundCarton.findMany({
        where: { inboundId: BigInt(inboundId) },
        include: { items: true },
        orderBy: { boxSeq: 'asc' },
      })
    }
    return rows.map((c) => ({
      id: Number(c.id),
      boxCode: c.boxCode,
      boxSeq: c.boxSeq,
      lengthCm: c.lengthCm != null ? Number(c.lengthCm) : null,
      widthCm: c.widthCm != null ? Number(c.widthCm) : null,
      heightCm: c.heightCm != null ? Number(c.heightCm) : null,
      grossWeightKg: c.grossWeightKg != null ? Number(c.grossWeightKg) : null,
      remark: c.remark ?? null,
      status: c.status,
      receivedAt: c.receivedAt,
      items: c.items.map((i) => ({
        id: Number(i.id),
        sku: i.sku,
        qty: i.qty,
        inboundItemId: i.inboundItemId ? Number(i.inboundItemId) : undefined,
      })),
    }))
  }

  private async loadPlatformScanIndex(
    items: Array<{ sku?: string | null; productId?: number | bigint | null }>,
    prodMap: Map<number, { sku?: string | null; customerSku?: string | null }>,
  ) {
    const skus = items.flatMap((item) => {
      const prod = prodMap.get(Number(item.productId))
      return [item.sku, prod?.sku, prod?.customerSku]
    })
    return loadPlatformBarcodesByInternalSku(this.prisma, skus.filter(Boolean) as string[])
  }

  private enrichInboundItem(
    item: any,
    prodMap: Map<number, any>,
    platformBySku: Map<string, string[]> = new Map(),
  ) {
    const prod = prodMap.get(Number(item.productId))
    const billing = resolveBillingDimensions(prod || {})
    const scan = productScanFields(item.sku, prod, platformBySku)
    return {
      ...item,
      id: Number(item.id),
      inboundId: item.inboundId != null ? Number(item.inboundId) : undefined,
      productId: Number(item.productId),
      productName: prod?.productName || item.sku,
      customerSku: prod?.customerSku || undefined,
      spec: prod?.spec || '',
      lengthCm: billing.lengthCm,
      widthCm: billing.widthCm,
      heightCm: billing.heightCm,
      weightKg: prod?.weightKg != null ? Number(prod.weightKg) : null,
      seaFreightPerUnit: item.seaFreightPerUnit != null ? Number(item.seaFreightPerUnit) : 0,
      costRmb: item.costRmb != null ? Number(item.costRmb) : null,
      domesticFeePerUnit: item.domesticFeePerUnit != null ? Number(item.domesticFeePerUnit) : null,
      dimensionsSource: billing.source === 'none' ? null : billing.source,
      barcode: scan.barcode,
      platformBarcode: scan.platformBarcode,
      platformBarcodes: scan.platformBarcodes,
    }
  }

  private findInboundItemByScan(
    order: { items: any[] },
    skuToken: string,
    prodMap: Map<number, { barcode?: string | null; sku?: string | null; customerSku?: string | null }>,
    platformBySku: Map<string, string[]> = new Map(),
  ) {
    const barcodes = new Map<number, string[]>()
    for (const item of order.items) {
      const prod = prodMap.get(Number(item.productId))
      const scan = productScanFields(item.sku, prod, platformBySku)
      barcodes.set(Number(item.productId), [scan.barcode, scan.platformBarcode, ...scan.platformBarcodes])
    }
    return matchInboundItemByScan(order.items, skuToken, barcodes)
  }

  async findByInboundNo(inboundNo: string) {
    const row = await this.prisma.inboundOrder.findUnique({ where: { inboundNo }, include: { items: true } })
    if (!row) throw new NotFoundException('入库单不存在')
    return { ...row, id: Number(row.id) }
  }

  readShipmentOutcome(requestId:string,actor:number){return readErpShipmentOutcome(this.prisma,requestId,actor)}

  async create(data: CreateErpShipmentDto, operatorId?: number) {
    if (!Number.isSafeInteger(operatorId) || !operatorId || operatorId <= 0) throw new ForbiddenException('请重新登录后创建发运单')
    const request = erpShipmentRequest(data)
    const fingerprint = erpShipmentFingerprint(request)
    const operationKey = data.clientRequestId || `manual:${request.inboundNo}`
    return this.prisma.$transaction(async tx => {
      // Operations are scoped to the signed-in operator, including retries across tabs.
      await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(operatorId)} FOR UPDATE`
      const previous = await tx.operationLog.findFirst({ where: { operatorId: BigInt(operatorId), module: 'inbound', action: 'create', detail: { path: '$.clientRequestId', equals: operationKey } } })
      if (previous) {
        const detail = (previous.detail || {}) as Record<string, unknown>
        if (detail.requestFingerprint !== fingerprint) throw new ConflictException('本次发运操作已用于其他内容，请先核对原入库单，请勿重复发运')
        const originalId = Number(detail.inboundId)
        const order = await tx.inboundOrder.findUnique({ where: Number.isSafeInteger(originalId) && originalId > 0 ? { id: BigInt(originalId) } : { inboundNo: previous.targetId || '' }, include: { items: true, cartons: { include: { items: true }, orderBy: { boxSeq: 'asc' } } } })
        if (!order) throw new ConflictException('原发运单已删除或无法核对，请返回入库管理核对，请勿重复提交原操作')
        if (!originalId && previous.createdAt && order.createdAt > previous.createdAt) throw new ConflictException('原发运单身份无法核对，请联系主管查看历史操作，请勿重复发运')
        return { ...order, id: Number(order.id), duplicate: true }
      }
      if (request.inboundNo && await tx.inboundOrder.findUnique({ where: { inboundNo: request.inboundNo } })) throw new ConflictException('入库单号已存在，请核对原单或填写新单号')
      if (request.inboundNo && await tx.operationLog.findFirst({ where: { module: 'inbound', targetId: request.inboundNo } })) throw new ConflictException('此入库单号曾经使用，不能重复使用历史单号，请填写新单号或留空自动生成')
      if (request.draftNo) await this.requireOwnedDraft(tx, request.draftNo, operatorId)
      const [sourceWh, destWh] = await Promise.all([
        tx.warehouse.findUnique({ where: { warehouseCode: request.sourceWarehouseCode } }),
        tx.warehouse.findUnique({ where: { warehouseCode: request.warehouseCode } }),
      ])
      if (!sourceWh || sourceWh.warehouseType !== 'logistics' || sourceWh.status !== 1) throw new BadRequestException('始发仓须为启用的物流中转仓')
      if (!destWh || destWh.warehouseType !== 'wms' || destWh.status !== 1) throw new BadRequestException('目的仓须为启用的海外仓')
      const ids = [...new Set(request.items.map(line => BigInt(line.productId)))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
      for (const id of ids) {
        await tx.$queryRaw`SELECT id FROM product WHERE id = ${id} FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM inventory WHERE product_id = ${id} AND warehouse_code = ${request.sourceWarehouseCode} FOR UPDATE`
      }
      const products = await tx.product.findMany({ where: { AND: [ERP_MASTER_PRODUCT_WHERE, { id: { in: ids } }] } })
      const productById = new Map(products.map(product => [Number(product.id), product]))
      const freightBySku = new Map(request.freightLines.map(line => [line.sku, line]))
      const resolved = [] as Array<{ line: typeof request.items[number]; product: typeof products[number]; stock: any; costRmb: number; seaFreightPerUnit: number; domesticFeePerUnit: number }>
      for (const line of request.items) {
        const product = productById.get(line.productId)
        if (!product || product.sku !== line.sku || product.status !== 'active') throw new BadRequestException(`${line.sku} 不是有效的 ERP 商品主数据，请重新选择商品`)
        const stock = await tx.inventory.findUnique({ where: { productId_warehouseCode: { productId: product.id, warehouseCode: request.sourceWarehouseCode } } })
        if (!stock || stock.availableQty < line.expectedQty || stock.totalQty - stock.lockedQty < line.expectedQty) throw new BadRequestException(`${line.sku} 中转仓可发数量不足，请重新读取库存后修改发运数量`)
        const dimensions = { lengthCm: line.lengthCm ?? Number(product.lengthCm), widthCm: line.widthCm ?? Number(product.widthCm), heightCm: line.heightCm ?? Number(product.heightCm), weightKg: line.weightKg ?? Number(product.weightKg) }
        if (!Object.values(dimensions).every(value => Number.isFinite(value) && value > 0)) throw new BadRequestException(`${line.sku} 请补充完整且大于零的单件长、宽、高和重量`)
        await tx.product.update({ where: { id: product.id }, data: dimensions })
        const freight = freightBySku.get(line.sku)
        resolved.push({ line, product, stock, costRmb: freight?.costRmb ?? Number(product.costRmb ?? 0), seaFreightPerUnit: freight?.seaFreightPerUnit ?? Number(product.seaFreightPerUnit ?? 0), domesticFeePerUnit: freight?.domesticFeePerUnit ?? Number(product.domesticFeePerUnit ?? 0) })
      }
      let order: any
      for (let attempt = 0; attempt < 5; attempt++) {
        const inboundNo = request.inboundNo || await this.allocateInboundNo(deriveCustomerCodeFromInternalSku(request.items[0].sku), tx)
        try {
          order = await tx.inboundOrder.create({ data: { inboundNo, sourceWarehouseCode: request.sourceWarehouseCode, warehouseCode: request.warehouseCode,
            warehouseNo: request.warehouseNo, trackingNo: request.trackingNo || null, remark: request.remark, status: 'pending_receipt',
            items: { create: resolved.map(row => ({ productId: row.product.id, sku: row.line.sku, expectedQty: row.line.expectedQty, remark: row.line.remark || null,
              costRmb: row.costRmb, seaFreightPerUnit: row.seaFreightPerUnit, domesticFeePerUnit: row.domesticFeePerUnit })) } },
            include: { items: true, cartons: { include: { items: true }, orderBy: { boxSeq: 'asc' } } } })
          break
        } catch (error) { if (request.inboundNo || (error as { code?: string })?.code !== 'P2002' || attempt === 4) throw error }
      }
      await this.persistCartons(tx, order, request.cartons)
      for (const row of resolved) {
        await tx.inventory.update({ where: { id: row.stock.id }, data: { totalQty: { decrement: row.line.expectedQty }, availableQty: { decrement: row.line.expectedQty } } })
        await tx.inventoryLog.create({ data: { productId: row.product.id, sku: row.line.sku, warehouseCode: request.sourceWarehouseCode, changeType: 'inbound_allocate', changeQty: -row.line.expectedQty,
          beforeQty: row.stock.totalQty, afterQty: row.stock.totalQty - row.line.expectedQty, referenceNo: order.inboundNo, operatorId: BigInt(operatorId), remark: `发运至海外仓 ${request.warehouseCode}` } })
      }
      await syncCatalogFromInbound(tx, { inboundNo: order.inboundNo, warehouseCode: request.warehouseCode, lines: resolved.map(row => ({ sku: row.line.sku, productName: row.product.productName, spec: row.product.spec || undefined,
        inboundQty: row.line.expectedQty, costRmb: row.costRmb, seaFreightPerUnit: row.seaFreightPerUnit, domesticFeePerUnit: row.domesticFeePerUnit })) })
      if (request.draftNo) {
        await tx.$executeRawUnsafe('UPDATE inbound_attachment SET inbound_id = ?, draft_no = NULL WHERE draft_no = ? AND inbound_id IS NULL', Number(order.id), request.draftNo)
        await tx.$executeRawUnsafe('DELETE FROM inbound_draft WHERE draft_no = ? AND operator_id = ?', request.draftNo, operatorId)
      }
      await tx.operationLog.create({ data: { operatorId: BigInt(operatorId), module: 'inbound', action: 'create', targetType: 'inbound_order', targetId: order.inboundNo,
        detail: { clientRequestId: operationKey, requestFingerprint: fingerprint, inboundId: Number(order.id), draftNo: request.draftNo, sourceWarehouseCode: request.sourceWarehouseCode, destWarehouseCode: request.warehouseCode, itemCount: resolved.length } } })
      const completed = await tx.inboundOrder.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, cartons: { include: { items: true }, orderBy: { boxSeq: 'asc' } } } })
      return { ...completed, id: Number(completed.id), duplicate: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 })
  }

  remove(id: number, operatorId?: number) {
    return removeErpShipment(this.prisma, id, operatorId)
  }

  applySeaFreight(id: number, body: ApplyShipmentFreightDto, operatorId?: number) {
    return this.writeSeaFreight(id, body, false, operatorId)
  }

  clearSeaFreight(id: number, body: ShipmentFreightMutationDto, operatorId?: number) {
    return this.writeSeaFreight(id, body, true, operatorId)
  }

  private async writeSeaFreight(id: number, body: ShipmentFreightMutationDto | ApplyShipmentFreightDto, clear: boolean, operatorId?: number) {
    const result = await writeErpShipmentFreight(this.prisma, id, body, clear, operatorId)
    try { return { ...(await this.detail(id, { reconcileCatalog: false })), ...result } }
    catch { return { ...result, refreshRequired: true, warning: '本次海运费操作已经完成，但详情未能读取，请重新读取最新详情，勿重复新建操作' } }
  }

  /** 写入外箱装箱明细（未传则按 SKU 行自动生成一箱） */
  private async persistCartons(
    tx: Pick<PrismaService, 'inboundCarton' | 'inboundCartonItem'>,
    order: { id: bigint; inboundNo: string; items: { id: bigint; productId: bigint; sku: string; expectedQty: number }[] },
    cartonsInput?: {
      boxCode?: string
      boxSeq?: number
      lengthCm?: number
      widthCm?: number
      heightCm?: number
      grossWeightKg?: number
      remark?: string
      items: { sku: string; qty: number }[]
    }[],
    options?: { replace?: boolean },
  ) {
    const existing = await tx.inboundCarton.count({ where: { inboundId: order.id } })
    if (existing > 0) {
      if (!options?.replace) return
      await tx.inboundCarton.deleteMany({ where: { inboundId: order.id } })
    }

    const itemBySku = new Map(order.items.map((i) => [String(i.sku).trim().toUpperCase(), i]))
    let cartonsDef = cartonsInput?.filter((c) => c.items?.length)
    if (!cartonsDef?.length) {
      cartonsDef = order.items.map((item, idx) => ({
        boxSeq: idx + 1,
        items: [{ sku: item.sku, qty: item.expectedQty }],
      }))
    }

    const merged = new Map<number, NonNullable<typeof cartonsInput>[number] & { boxSeq: number }>()
    let autoSeq = 0
    for (const carton of cartonsDef) {
      const boxSeq = Number(carton.boxSeq) > 0 ? Number(carton.boxSeq) : ++autoSeq
      const current = merged.get(boxSeq) ?? { ...carton, boxSeq, items: [] as { sku: string; qty: number }[] }
      if (!current.boxCode && carton.boxCode) current.boxCode = carton.boxCode
      for (const line of carton.items) {
        const sku = String(line.sku || '').trim()
        const qty = Number(line.qty)
        const hit = current.items.find((item) => item.sku.toUpperCase() === sku.toUpperCase())
        if (hit) hit.qty += qty
        else current.items.push({ sku, qty })
      }
      merged.set(boxSeq, current)
    }
    cartonsDef = [...merged.values()].sort((a, b) => a.boxSeq - b.boxSeq)

    const expectedBySku = new Map<string, number>()
    for (const item of order.items) {
      const key = String(item.sku).trim().toUpperCase()
      expectedBySku.set(key, (expectedBySku.get(key) || 0) + item.expectedQty)
    }
    const packedBySku = new Map<string, number>()
    for (const c of cartonsDef) {
      for (const line of c.items) {
        const key = String(line.sku).trim().toUpperCase()
        if (!itemBySku.has(key)) throw new BadRequestException(`外箱明细 SKU ${line.sku} 不在入库单中`)
        const qty = Number(line.qty)
        if (!qty || qty <= 0) throw new BadRequestException(`外箱 ${line.sku} 数量无效`)
        packedBySku.set(key, (packedBySku.get(key) || 0) + qty)
      }
    }
    for (const [sku, expected] of expectedBySku) {
      const packed = packedBySku.get(sku) || 0
      if (packed !== expected) {
        throw new BadRequestException(`外箱装箱数量与明细不一致：${sku} 装箱 ${packed} ≠ 应收 ${expected}`)
      }
    }

    let seq = 0
    for (const c of cartonsDef) {
      seq += 1
      const boxSeq = c.boxSeq ?? seq
      const boxCode = String(c.boxCode || '').trim() || buildCartonCode(order.inboundNo, boxSeq)
      const lengthCm = Number(c.lengthCm)
      const widthCm = Number(c.widthCm)
      const heightCm = Number(c.heightCm)
      const grossWeightKg = Number(c.grossWeightKg)
      const cartonRemark = String(c.remark || '').trim()
      await tx.inboundCarton.create({
        data: {
          inboundId: order.id,
          boxCode,
          boxSeq,
          lengthCm: lengthCm > 0 ? lengthCm : null,
          widthCm: widthCm > 0 ? widthCm : null,
          heightCm: heightCm > 0 ? heightCm : null,
          grossWeightKg: grossWeightKg > 0 ? grossWeightKg : null,
          remark: cartonRemark || null,
          items: {
            create: c.items.map((line) => {
              const item = itemBySku.get(String(line.sku).trim().toUpperCase())!
              return {
                inboundItemId: item.id,
                productId: item.productId,
                sku: item.sku,
                qty: Number(line.qty),
              }
            }),
          },
        },
      })
    }
  }

  private async allocateInboundNo(customerCode?: string, db: Pick<PrismaService, 'inboundOrder' | 'operationLog'> = this.prisma) {
    const prefix = inboundNoPrefix(customerCode)
    const rows = await db.inboundOrder.findMany({
      where: { inboundNo: { startsWith: prefix } },
      select: { inboundNo: true },
    })
    const history = await db.operationLog.findMany({ where: { module: 'inbound', targetId: { startsWith: prefix } }, select: { targetId: true } })
    return buildInboundNo(customerCode, new Date(), nextSeqFromNos([...rows.map(row => row.inboundNo), ...history.map(row => row.targetId || '')], prefix))
  }

  private async findPendingCarton(inboundId: number, inboundNo: string, scanCode: string) {
    const cartons = await this.prisma.inboundCarton.findMany({
      where: { inboundId: BigInt(inboundId), status: 'pending' },
      include: { items: true },
    })
    return matchCartonByScan(cartons, scanCode, inboundNo)
  }

  private buildReceiveSummary(order: any) {
    const totalExpected = order.items.reduce((s: number, i: any) => s + i.expectedQty, 0)
    const totalReceived = order.items.reduce((s: number, i: any) => s + (i.actualQty ?? 0), 0)
    const cartons = order.cartons || []
    const expectedCartonCount = cartons.length || null
    const scannedCartonCount = cartons.filter((c: { status?: string }) => c.status === 'received').length
    return {
      totalExpected,
      totalReceived,
      allReceived: totalReceived >= totalExpected,
      expectedCartonCount,
      scannedCartonCount,
      receivedCartonCount: order.receivedCartonCount ?? null,
    }
  }

  /** 扫箱收货：人工清点实收箱数 */
  async recordReceivedCartonCount(id: number, body: RecordInboundCartonsDto, operatorId?: number) {
    return this.syncReceivingStatus(await runInboundReceiving(this.prisma, id, 'carton-count', body, operatorId))
  }

  reduceQuantity(id: number, mode: 'qc' | 'carton' | 'putaway', body: InboundControlDto, operatorId?: number) {
    return this.control(id, `reduce-${mode}`, body, operatorId)
  }

  /** 扫外箱只确认箱数，SKU实收仍需清点，原请求可在响应丢失后重试。 */
  async receiveBox(id: number, body: ScanInboundCartonDto, operatorId?: number) {
    return this.syncReceivingStatus(await runInboundReceiving(this.prisma, id, 'carton-scan', body, operatorId))
  }

  async startReceive(id: number, operatorId?: number) {
    const result = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM inbound_order WHERE id = ${BigInt(id)} FOR UPDATE`
      const order = await tx.inboundOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true } })
      if (!order) throw new NotFoundException('入库单已删除或不存在，请返回列表重新读取')
      if (TERMINAL_STATUSES.has(order.status)) throw new BadRequestException('该入库单已完结')
      if (order.status === 'receiving') return { ...order, duplicate: true }
      if (order.status !== 'arrived') {
        if (PENDING_RECEIPT_STATUSES.has(order.status)) throw new BadRequestException('请先在「到仓扫描」确认到货后再收货')
        throw new BadRequestException(`当前状态「${inboundStatusLabel(order.status)}」不可开始收货`)
      }
      const updated = await tx.inboundOrder.update({ where: { id: order.id }, data: { status: 'receiving', receivedAt: new Date(), receivedBy: operatorId ? BigInt(operatorId) : undefined }, include: { items: true } })
      await tx.operationLog.create({ data: { operatorId: operatorId ? BigInt(operatorId) : undefined, module: 'inbound', action: 'start_receive', targetType: 'inbound_order', targetId: order.inboundNo } })
      return { ...updated, duplicate: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
    await this.pushInboundStatusToOms(result.inboundNo)
    return { ...result, id: Number(result.id) }
  }

  /** 收货清点时扫描 SKU 标签，校验是否属于本入库单（不写入数量） */
  async scanReceiptLabel(id: number, scanCode: string) {
    const code = String(scanCode || '').trim()
    if (!code) throw new BadRequestException('请扫描或输入 SKU 标签')

    const order = await this.detail(id)
    if (TERMINAL_STATUSES.has(order.status)) throw new BadRequestException('该入库单已完结')
    if (!['arrived', 'receiving'].includes(order.status)) {
      throw new BadRequestException(`当前状态「${inboundStatusLabel(order.status)}」不可扫描收货标签`)
    }

    const normalized = code.toUpperCase()
    const item = order.items.find((i) => String(i.sku).trim().toUpperCase() === normalized)
    if (!item) {
      throw new NotFoundException(`标签 ${code} 不属于入库单 ${order.inboundNo}`)
    }

    return {
      inboundId: order.id,
      inboundNo: order.inboundNo,
      scanCode: code,
      sku: item.sku,
      productName: item.productName || '',
      expectedQty: item.expectedQty,
      actualQty: item.actualQty ?? item.expectedQty,
      itemId: item.id,
    }
  }

  /** 扫码增量和测量在单据锁内提交，防止并发覆盖。 */
  async scanQc(id: number, body: ScanInboundQcDto, operatorId?: number) {
    return this.syncReceivingStatus(await runInboundReceiving(this.prisma, id, 'qc-scan', body, operatorId))
  }

  async reportException(id: number, payload: any, operatorId?: number) {
    const order = await this.detail(id)
    if (TERMINAL_STATUSES.has(order.status)) throw new BadRequestException('该入库单已完结，不能登记现场异常')
    const exceptionTypes: Record<string, string> = {
      unknown_barcode: '未知条码',
      missing_carton: '少箱',
      extra_carton: '多箱',
      damaged_carton: '外箱破损',
      mixed_carton: '混装',
      sku_mismatch: 'SKU 不符',
      damaged_goods: '货品破损',
      other: '其他异常',
    }
    const exceptionType = String(payload?.exceptionType || '').trim()
    if (!exceptionTypes[exceptionType]) throw new BadRequestException('请选择有效的收货异常类型')
    const scanCode = String(payload?.scanCode || '').trim().slice(0, 100)
    const remark = String(payload?.remark || '').trim().slice(0, 500)
    if (!scanCode && remark.length < 2) throw new BadRequestException('请填写异常条码或异常说明')
    await this.opLog.log({
      operatorId,
      module: 'inbound',
      action: 'report_exception',
      targetType: 'inbound_order',
      targetId: order.inboundNo,
      detail: {
        exceptionType,
        exceptionTypeLabel: exceptionTypes[exceptionType],
        scanCode: scanCode || null,
        remark: remark || null,
        workStatus: order.status,
      },
    })
    return { message: `${exceptionTypes[exceptionType]}已登记，主管可在操作日志中核对` }
  }

  /** 海外仓到仓扫描：pending_receipt → arrived */
  async bindCatalogInbound(data: { scanCode: string; warehouseCode: string }, operatorId?: number) {
    const scanCode = String(data.scanCode || '').trim()
    const warehouseCode = String(data.warehouseCode || '').trim()
    if (!scanCode || !warehouseCode) throw new BadRequestException('请先选择作业仓库并扫描入库单号')
    const order = await this.prisma.inboundOrder.findFirst({
      where: { inboundNo: scanCode, warehouseCode }, include: { items: true },
    })
    if (!order) throw new NotFoundException('未找到当前仓库的入库单，请扫描完整入库单号')
    if (!isCatalogPurchaseInbound(order)) throw new BadRequestException('货盘入库只接受 ERP 货盘采购发运的入库单，不支持客户预约或客户自有货物入库单')
    if (!PENDING_RECEIPT_STATUSES.has(order.status) && !QC_STATUSES.has(order.status) && !PUTAWAY_STATUSES.has(order.status)) {
      throw new BadRequestException(`当前状态「${inboundStatusLabel(order.status)}」不可绑定货盘入库作业`)
    }
    if (PENDING_RECEIPT_STATUSES.has(order.status)) {
      await this.arrivalScan({ scanCode, warehouseCode }, operatorId)
    }
    return this.detail(Number(order.id))
  }

  async arrivalScan(data: { scanCode: string; warehouseCode: string }, operatorId?: number) {
    const scanCode = String(data.scanCode || '').trim()
    const warehouseCode = String(data.warehouseCode || '').trim()
    if (!scanCode) throw new BadRequestException('请扫描或输入单号')
    if (!warehouseCode) throw new BadRequestException('请选择操作仓库')
    const inboundNo = inboundNoFromScan(scanCode) || scanCode
    const result = await this.prisma.$transaction(async tx => {
      const wh = await tx.warehouse.findUnique({ where: { warehouseCode } })
      if (!wh || wh.warehouseType !== 'wms' || wh.status !== 1) throw new BadRequestException('操作仓库必须是启用的海外仓')
      await tx.$queryRaw`SELECT id FROM inbound_order WHERE inbound_no = ${inboundNo} AND warehouse_code = ${warehouseCode} FOR UPDATE`
      const order = await tx.inboundOrder.findFirst({ where: { warehouseCode, inboundNo }, include: { items: true, cartons: { include: { items: true }, orderBy: { boxSeq: 'asc' } } } })
      if (!order) throw new NotFoundException(`未找到入库单号 ${scanCode}。到仓扫描只接受入库单号，不支持入仓号或跟踪号`)
      if (order.status === 'arrived' || (order.arrivedAt && ['receiving', 'pending_putaway', 'completed', 'confirmed'].includes(order.status))) return { order, alreadyScanned: true }
      if (!PENDING_RECEIPT_STATUSES.has(order.status)) throw new BadRequestException(`入库单 ${order.inboundNo} 当前状态「${inboundStatusLabel(order.status)}」不可到仓扫描`)
      const now = new Date()
      const updated = await tx.inboundOrder.update({ where: { id: order.id }, data: { status: 'arrived', arrivedAt: now, arrivedBy: operatorId ? BigInt(operatorId) : undefined }, include: { items: true, cartons: { include: { items: true }, orderBy: { boxSeq: 'asc' } } } })
      await tx.inboundArrivalScan.create({ data: { inboundId: order.id, scanCode, scanType: 'inbound_no', warehouseCode, operatorId: operatorId ? BigInt(operatorId) : undefined, scannedAt: now } })
      await tx.operationLog.create({ data: { operatorId: operatorId ? BigInt(operatorId) : undefined, module: 'inbound', action: 'arrival_scan', targetType: 'inbound_order', targetId: order.inboundNo, detail: { scanCode, warehouseCode } } })
      return { order: updated, alreadyScanned: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
    await this.pushInboundStatusToOms(result.order.inboundNo)
    return { alreadyScanned: result.alreadyScanned, message: result.alreadyScanned ? '该入库单已登记到仓，已读取最新作业状态，无需重复扫描' : `${result.order.inboundNo} 到仓扫描成功`, order: this.serializeInbound(result.order) }
  }

  async listArrivalScans(q: { warehouseCode?: string; limit?: number }) {
    const limit = Math.min(Number(q.limit) || 30, 100)
    const where: any = {}
    if (q.warehouseCode) where.warehouseCode = q.warehouseCode
    const rows = await this.prisma.inboundArrivalScan.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit,
    })
    const inboundIds = [...new Set(rows.map((r) => r.inboundId))] as bigint[]
    const orders = inboundIds.length
      ? await this.prisma.inboundOrder.findMany({
          where: { id: { in: inboundIds } },
          select: { id: true, inboundNo: true, warehouseNo: true, poId: true, status: true },
        })
      : []
    const orderMap = new Map(orders.map((o) => [Number(o.id), o]))
    return rows.map((r) => {
      const order = orderMap.get(Number(r.inboundId))
      return {
        id: Number(r.id),
        inboundId: Number(r.inboundId),
        inboundNo: order?.inboundNo || '',
        warehouseNo: order?.warehouseNo || '',
        status: order?.status || '',
        scanCode: r.scanCode,
        scanType: r.scanType,
        warehouseCode: r.warehouseCode,
        scannedAt: r.scannedAt.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      }
    })
  }

  private extractWarehouseNo(remark?: string): string | undefined {
    if (!remark) return undefined
    const m = remark.match(/入仓:([^\s]+)/)
    return m?.[1]
  }

  private serializeInbound(row: any) {
    return {
      ...row,
      id: Number(row.id),
      items: (row.items || []).map((i: any) => ({ ...i, id: Number(i.id) })),
    }
  }

  manageCount(id: number, mode: 'reopen' | 'close-zero', body: InboundControlDto, operatorId?: number) {
    return this.control(id, mode === 'reopen' ? 'reopen-count' : 'close-zero', body, operatorId)
  }

  private async control(id: number, kind: InboundControlKind, body: InboundControlDto, operatorId?: number) {
    const result = await runInboundControl(this.prisma, this.inventoryMutation, id, kind, body, operatorId)
    try {
      await this.pushInboundStatusToOms(result.inboundNo, true)
      return result
    } catch {
      return { ...result, syncPending: true, warning: '处理已保存，但OMS同步未完成；请核对并重试原操作，勿重新更正或撤回库存' }
    }
  }

  qc(id: number, payload: SubmitInboundQcDto, operatorId?: number) {
    return this.receivingWithFees(id, 'qc-submit', payload, operatorId)
  }

  qcAndMeasure(id: number, payload: SubmitInboundQcDto, operatorId?: number) {
    return this.receivingWithFees(id, 'qc-measure-submit', payload, operatorId)
  }

  private async receivingWithFees(id: number, kind: 'qc-submit' | 'qc-measure-submit' | 'measure', payload: SubmitInboundQcDto | MeasureInboundDto, operatorId?: number) {
    const result = await runInboundReceiving(this.prisma, id, kind, payload, operatorId)
    let feePending = false
    try {
      const order = await this.prisma.inboundOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true } })
      if (!order) throw new Error('Original receipt unavailable')
      if (kind !== 'measure') await this.inboundFee.recordOperation(order, 'qc', pieceQty(result.items || order.items), true)
      if (kind !== 'qc-submit' && result.measuredCount > 0) await this.inboundFee.recordOperation(order, 'measure', result.measuredCount, true)
    } catch {
      feePending = true
    }
    const synced = await this.syncReceivingStatus(result)
    return feePending ? { ...synced, feePending: true, warning: synced.syncPending
      ? '仓库作业已保存，但费用与OMS状态同步未完成；请用原操作重试核对，勿重新建立操作'
      : '仓库作业已保存，但费用同步未完成；请用原操作重试核对，勿重新建立操作' } : synced
  }

  private async syncReceivingStatus<T extends { inboundNo: string }>(result: T) {
    try {
      await this.pushInboundStatusToOms(result.inboundNo, true)
      return { ...result, syncPending: false }
    } catch {
      return { ...result, syncPending: true, warning: '仓库作业已保存，但OMS状态或库存同步未完成；请用原操作重试核对，勿重新收箱或清点' }
    }
  }

  resolveException(id: number, body: InboundControlDto, operatorId?: number) {
    return this.control(id, 'resolve-exception', body, operatorId)
  }

  measureDimensions(id: number, payload: MeasureInboundDto, operatorId?: number) {
    return this.receivingWithFees(id, 'measure', payload, operatorId)
  }

  async putaway(id: number, payload: PutawayInboundDto, operatorId?: number) {
    const result = await runInboundPutaway(this.prisma, this.inventoryMutation, id, payload, operatorId)
    try {
      if (result.allDone) {
        const skus: string[] = result.items.map(item => item.sku)
        await tryMarkOrderableOnOmsForSkus(this.prisma, skus)
        // Retry the latest presentation even if a previous attempt already set orderable.
        for (const sku of [...new Set(skus)]) await pushCatalogStockToOms(this.prisma, sku)
        await this.inboundFee.recordOperation(result, 'putaway', pieceQty(result.items, 'putawayQty'), true)
      }
      await this.pushInboundStatusToOms(result.inboundNo, true)
      return result
    } catch {
      return { ...result, syncPending: true, warning: '上架与库存已保存，但费用或OMS同步尚未完成；请核对并重试原操作，不要重新上架' }
    }
  }

  /** Legacy one-click completion cannot infer actual quantities, measurements or a physical bin. */
  async confirm(id: number, _payload: any, _operatorId?: number) {
    const order = await this.detail(id)
    if (TERMINAL_STATUSES.has(order.status)) throw new BadRequestException('该入库单已确认，请返回入库单管理查看结果')
    throw new BadRequestException('请在「到仓扫描」完成实际清点与测量，并选择实际库位上架；不能自动确认实收或默认上架')
  }

  // ── 草稿 ──

  private requireDraftOperator(operatorId?: number): number {
    if (!Number.isSafeInteger(operatorId) || !operatorId || operatorId <= 0) throw new ForbiddenException('请重新登录后操作草稿')
    return operatorId
  }

  private async requireOwnedDraft(tx: Pick<PrismaService, '$queryRawUnsafe'>, draftNo: string, operatorId: number) {
    const rows = await tx.$queryRawUnsafe<any[]>('SELECT operator_id AS operatorId FROM inbound_draft WHERE draft_no = ? FOR UPDATE', draftNo)
    if (!rows.length) throw new NotFoundException('草稿不存在，请返回草稿箱重新读取')
    if (Number(rows[0].operatorId) !== operatorId) throw new ForbiddenException('只能操作本人创建的草稿')
  }

  async listDrafts(operatorId?: number) {
    const ownerId = this.requireDraftOperator(operatorId)
    const rows = await this.prisma.$queryRawUnsafe<any[]>('SELECT draft_no AS draftNo, form_data AS formData, saved_at AS savedAt FROM inbound_draft WHERE operator_id = ? ORDER BY saved_at DESC', ownerId)
    const attachments = await this.prisma.$queryRawUnsafe<any[]>('SELECT a.id, a.draft_no AS draftNo, a.file_name AS fileName FROM inbound_attachment a JOIN inbound_draft d ON d.draft_no = a.draft_no WHERE d.operator_id = ? AND a.inbound_id IS NULL ORDER BY a.id', ownerId)
    return rows.map(row => {
      const form = typeof row.formData === 'string' ? JSON.parse(row.formData) : row.formData
      return { id: row.draftNo, draftNo: row.draftNo, savedAt: row.savedAt, _form: { ...form, attachments: attachments.filter(file => file.draftNo === row.draftNo).map(file => ({ id: Number(file.id), fileName: file.fileName })) } }
    })
  }

  async saveDraft(draftNo: string, formData: any, operatorId?: number) {
    const ownerId = this.requireDraftOperator(operatorId)
    if (!draftNo?.trim() || draftNo.length > 30 || !formData || typeof formData !== 'object' || Array.isArray(formData)) throw new BadRequestException('请提供有效草稿号和表单内容')
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(ownerId)} FOR UPDATE`
      const submitted = await tx.operationLog.findFirst({ where: { operatorId: BigInt(ownerId), module: 'inbound', action: 'create', detail: { path: '$.draftNo', equals: draftNo } } })
      if (submitted) throw new ConflictException('该草稿已转为正式入库单，请返回入库单管理查看，请勿重复保存发运')
      const rows = await tx.$queryRawUnsafe<any[]>('SELECT operator_id AS operatorId FROM inbound_draft WHERE draft_no = ? FOR UPDATE', draftNo)
      if (rows.length && Number(rows[0].operatorId) !== ownerId) throw new ForbiddenException('只能操作本人创建的草稿')
      if (rows.length) await tx.$executeRawUnsafe('UPDATE inbound_draft SET form_data = ?, saved_at = CURRENT_TIMESTAMP WHERE draft_no = ? AND operator_id = ?', JSON.stringify(formData), draftNo, ownerId)
      else await tx.$executeRawUnsafe('INSERT INTO inbound_draft (draft_no, operator_id, form_data) VALUES (?, ?, ?)', draftNo, ownerId, JSON.stringify(formData))
      return { draftNo, savedAt: new Date() }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
  }

  async deleteDraft(draftNo: string, operatorId?: number) {
    const ownerId = this.requireDraftOperator(operatorId)
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(ownerId)} FOR UPDATE`
      await this.requireOwnedDraft(tx, draftNo, ownerId)
      await tx.$executeRawUnsafe('DELETE FROM inbound_attachment WHERE draft_no = ? AND inbound_id IS NULL', draftNo)
      await tx.$executeRawUnsafe('DELETE FROM inbound_draft WHERE draft_no = ? AND operator_id = ?', draftNo, ownerId)
      return { ok: true }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
  }

  async uploadAttachment(data: { inboundId?: number; draftNo?: string; fileName: string; contentBase64: string }, operatorId?: number) {
    const ownerId = this.requireDraftOperator(operatorId)
    if (!data.draftNo || data.inboundId) throw new BadRequestException('请先保存本人草稿后上传附件')
    if (!data.fileName?.trim() || /[\\/\0]/.test(data.fileName) || ['.', '..'].includes(data.fileName)) throw new BadRequestException('附件文件名无效，请重新选择文件')
    const encoded = String(data.contentBase64 || '')
    if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new BadRequestException('附件内容无效，请重新选择文件')
    const buf = Buffer.from(encoded, 'base64')
    if (!buf.length || buf.toString('base64') !== encoded) throw new BadRequestException('附件不能为空或已损坏，请重新选择文件')
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(ownerId)} FOR UPDATE`
      await this.requireOwnedDraft(tx, data.draftNo!, ownerId)
      const { relativePath } = this.files.write('inbound-attachments', `${randomUUID()}_${data.fileName}`, buf)
      await tx.$executeRawUnsafe('INSERT INTO inbound_attachment (inbound_id, draft_no, file_name, file_path) VALUES (NULL, ?, ?, ?)', data.draftNo, data.fileName, relativePath)
      return { fileName: data.fileName }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
  }

  async downloadAttachment(id: number) {
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      'SELECT file_name as fileName, file_path as filePath FROM inbound_attachment WHERE id = ?',
      id,
    )
    if (!rows.length) throw new NotFoundException('附件不存在')
    return { fileName: rows[0].fileName, content: this.files.read(rows[0].filePath) }
  }

  buildSkuLabelHtml(order: any, sku?: string) {
    const items = sku ? order.items.filter((i: any) => i.sku === sku) : order.items
    return buildSkuLabelsHtml(
      (items || []).map((item: any) => ({
        sku: inboundCustomerSku(item, order.omsCustomerCode),
        qty: item.expectedQty,
      })),
      { title: `SKU标签_${order.inboundNo}` },
    )
  }

  buildOuterLabelHtml(order: any) {
    const cartons: any[] = order.cartons || []
    if (!cartons.length) {
      return `<!DOCTYPE html><html><body>
        <div style="width:100mm;height:100mm;border:2px solid #000;padding:6mm;font-family:Arial,sans-serif">
          <div style="font-size:12px;font-weight:bold;letter-spacing:2px">外箱标 OUTER CARTON</div>
          <div style="font-size:18px;font-weight:bold;margin:4mm 0">${order.inboundNo}</div>
          <div style="font-size:11px">Warehouse: ${order.warehouseCode}</div>
        </div>
      </body></html>`
    }
    const blocks = cartons.map((c) => {
      const lines = (c.items || []).map((i: any) => `<div style="font-size:11px">${i.sku} × ${i.qty}</div>`).join('')
      return `<div style="width:100mm;height:100mm;border:2px solid #000;padding:6mm;font-family:Arial,sans-serif;page-break-after:always">
        <div style="font-size:12px;font-weight:bold;letter-spacing:2px">外箱标 OUTER CARTON</div>
        <div style="font-size:20px;font-weight:bold;margin:3mm 0;font-family:monospace">${c.boxCode}</div>
        <div style="font-size:11px">入库单: ${order.inboundNo}</div>
        <div style="font-size:11px;margin-top:2mm">Warehouse: ${order.warehouseCode}</div>
        <div style="margin-top:4mm;border-top:1px solid #ccc;padding-top:3mm">${lines}</div>
      </div>`
    }).join('')
    return `<!DOCTYPE html><html><body>${blocks}</body></html>`
  }

  async getSkuLabel(id: number, sku?: string) {
    const order = await this.detail(id)
    const items = sku ? order.items.filter((i: any) => i.sku === sku) : order.items
    const pdf = await buildSkuLabelsPdfBuffer(
      (items || []).map((item: any) => ({
        sku: inboundCustomerSku(item, order.omsCustomerCode),
        qty: item.expectedQty,
      })),
      {},
    )
    const fileName = `SKU标签_${order.inboundNo}.pdf`
    this.files.write('labels', fileName, pdf)
    const printDelta = (order.items || [])
      .filter((i: any) => !sku || i.sku === sku)
      .reduce((s: number, i: any) => s + Number(i.expectedQty || 0), 0)
    await this.prisma.inboundOrder.update({
      where: { id: BigInt(id) },
      data: { labelPrintCount: { increment: Math.max(printDelta, 1) } },
    })
    await this.inboundFee.recordOperation(order, 'label', Math.max(printDelta, 1))
    return { fileName, content: pdf, mimeType: 'application/pdf' }
  }

  async getOuterLabel(id: number) {
    const order = await this.detail(id)
    const labels = buildInboundBoxLabelData(order)
    const pdf = await buildBoxLabelsPdfBuffer(labels)
    const fileName = `外箱标_${order.inboundNo}.pdf`
    this.files.write('labels', fileName, pdf)
    await this.prisma.inboundOrder.update({
      where: { id: BigInt(id) },
      data: { labelPrintCount: { increment: order.cartons?.length || 1 } },
    })
    await this.inboundFee.recordOperation(order, 'label', order.cartons?.length || pieceQty(order.items) || 1)
    return { fileName, content: pdf, mimeType: 'application/pdf' }
  }

  async getReceivingList(id: number) {
    const order = await this.detail(id)
    return this.buildReceivingListFile(order)
  }

  async getReceivingListForOms(inboundNo: string, customerCode: string) {
    const code = String(customerCode || '').trim()
    if (!code) throw new BadRequestException('缺少客户编码')
    const row = await this.prisma.inboundOrder.findUnique({ where: { inboundNo: inboundNo.trim() } })
    if (!row || row.omsCustomerCode !== code) throw new NotFoundException('入库单不存在')
    return this.getReceivingList(Number(row.id))
  }

  private async buildReceivingListFile(order: any) {
    const skuList: string[] = (order.items || [])
      .map((item: { sku?: string }) => String(item.sku || '').trim())
      .filter((sku) => sku.length > 0)
    const skus = [...new Set<string>(skuList)]
    const firstArrival = new Set(skus)
    if (order.omsCustomerCode && skus.length) {
      const prior = await this.prisma.inboundOrderItem.findMany({
        where: {
          sku: { in: skus },
          inboundId: { not: BigInt(order.id) },
          order: {
            omsCustomerCode: order.omsCustomerCode,
            status: { in: ['completed', 'confirmed'] },
          },
        },
        select: { sku: true },
      })
      for (const row of prior) firstArrival.delete(row.sku)
    }
    const warehouse = printInboundWarehouseCode(order.warehouseCode)
    const remark = stripOmsSystemTags(order.remark) || ''
    const html = buildInboundReceivingListHtml({
      inboundNo: order.inboundNo,
      createdAt: formatInboundListDateTime(order.createdAt),
      shipWarehouse: printInboundWarehouseCode(order.sourceWarehouseCode || order.warehouseCode),
      destWarehouse: warehouse,
      customerCode: order.omsCustomerCode || '',
      trackingNo: order.trackingNo || '',
      referenceNo: order.referenceNo || '',
      remark,
      csRemark: remark,
      printedAt: formatInboundListDateTime(new Date()),
      skus: groupReceivingListSkus({
        inboundNo: order.inboundNo,
        items: (order.items || []).map((item: any) => ({
          sku: item.sku,
          name: item.productName,
          expectedQty: item.expectedQty,
          actualQty: item.actualQty,
          firstArrival: firstArrival.has(item.sku),
          weightKg: item.weightKg,
          lengthCm: item.lengthCm,
          widthCm: item.widthCm,
          heightCm: item.heightCm,
        })),
        cartons: order.cartons,
      }),
    })
    return {
      fileName: `入库清单_${order.inboundNo}.html`,
      content: Buffer.from(html, 'utf-8'),
      mimeType: 'text/html;charset=utf-8',
    }
  }

  // ───────────── OMS P1：客户预约入库 ASN（不扣中转仓库存） ─────────────

  private mapInboundForOms(order: {
    id: bigint | number
    inboundNo: string
    warehouseCode: string
    trackingNo: string | null
    status: string
    remark: string | null
    omsCustomerCode?: string | null
    inboundType?: string | null
    deliveryMethod?: string | null
    stockSource?: string | null
    referenceNo?: string | null
    eta?: string | null
    contact?: string | null
    contactPhone?: string | null
    createdAt: Date
    updatedAt: Date
    arrivedAt?: Date | null
    receivedAt?: Date | null
    putawayAt?: Date | null
    items?: { sku: string; expectedQty: number; actualQty?: number | null; productId: bigint; remark?: string | null }[]
    cartons?: Array<{
      boxSeq: number
      boxCode: string
      items?: Array<{ sku: string; qty: number }>
    }>
  }) {
    const displayStatus = normalizeInboundStatus(order.status)
    const items = (order.items || []).map((i) => ({
      sku: i.sku,
      expectedQty: i.expectedQty,
      receivedQty: i.actualQty ?? 0,
      productId: Number(i.productId),
      productName: i.remark || i.sku,
    }))
    const cartons = (order.cartons || []).map((carton) => ({
      boxSeq: carton.boxSeq,
      boxCode: carton.boxCode,
      items: (carton.items || []).map((item) => ({ sku: item.sku, qty: item.qty })),
    }))
    const meta = parseOmsInboundMeta(order.remark)
    const totalExpectedQty = items.reduce((s, i) => s + i.expectedQty, 0)
    const totalReceivedQty = items.reduce((s, i) => s + i.receivedQty, 0)
    // A short-received ASN can be physically put away, but must not be shown
    // to OMS as fully shelved. The `partial` status keeps the shortage clear.
    const omsStatus = displayStatus === 'completed'
      && totalReceivedQty < totalExpectedQty
      ? 'partial'
      : this.toOmsInboundStatus(displayStatus)
    return {
      id: Number(order.id),
      inboundNo: order.inboundNo,
      warehouseCode: order.warehouseCode,
      trackingNo: order.trackingNo,
      status: order.status,
      displayStatus,
      omsStatus,
      omsCustomerCode: order.omsCustomerCode ?? null,
      remark: stripOmsSystemTags(order.remark),
      source: meta.source || null,
      inboundType: order.inboundType || meta.inboundType || null,
      deliveryMethod: order.deliveryMethod || meta.deliveryMethod || null,
      stockSource: order.stockSource || meta.stockSource || 'owned',
      referenceNo: order.referenceNo || meta.referenceNo || null,
      eta: order.eta || meta.eta || null,
      contact: order.contact || meta.contact || null,
      contactPhone: order.contactPhone || meta.contactPhone || null,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      arrivedAt: order.arrivedAt ?? null,
      receivedAt: order.receivedAt ?? null,
      putawayAt: order.putawayAt ?? null,
      totalExpectedQty,
      totalReceivedQty,
      items,
      cartons,
    }
  }

  private toOmsInboundStatus(displayStatus: string): string {
    switch (displayStatus) {
      case 'pending_receipt':
        return 'on_the_way'
      case 'arrived':
      case 'receiving':
        return 'receiving'
      case 'pending_putaway':
        return 'partial'
      case 'completed':
        return 'shelved'
      case 'exception':
        return 'exception'
      case 'cancelled':
        return 'voided'
      default:
        return displayStatus
    }
  }

  private resolveWmsWarehouseCode(code: string): string {
    const aliases: Record<string, string> = {
      jhb1: 'WMS-JHB-01',
      jhb: 'WMS-JHB-01',
      'wms-jhb-01': 'WMS-JHB-01',
      cpt1: 'WMS-CPT-01',
      cpt: 'WMS-CPT-01',
      'wms-cpt-01': 'WMS-CPT-01',
      dbn: 'WMS-DBN-01',
      'wms-dbn-01': 'WMS-DBN-01',
    }
    return aliases[code.toLowerCase()] || code
  }

  private async ensureProductBySku(
    sku: string,
    productName?: string,
    customerCode?: string,
  ): Promise<{ id: bigint; sku: string; productName: string }> {
    const trimmed = sku.trim()
    if (!trimmed) throw new BadRequestException('SKU 不能为空')

    const existing = await this.prisma.product.findUnique({ where: { sku: trimmed } })
    if (existing) {
      return { id: existing.id, sku: existing.sku, productName: existing.productName }
    }

    const code = String(customerCode || '').trim().toUpperCase()
    if (code) {
      const prefixedSku = buildInternalSku(code, trimmed, [])
      const byPrefixed = await this.prisma.product.findUnique({ where: { sku: prefixedSku } })
      if (byPrefixed) {
        return { id: byPrefixed.id, sku: byPrefixed.sku, productName: byPrefixed.productName }
      }

      const byCustomerSku = await this.prisma.product.findFirst({
        where: { customerSku: trimmed, sku: { startsWith: `${code}-` } },
      })
      if (byCustomerSku) {
        return { id: byCustomerSku.id, sku: byCustomerSku.sku, productName: byCustomerSku.productName }
      }
    } else {
      const byCustomerSku = await this.prisma.product.findMany({
        where: { customerSku: trimmed },
        take: 2,
      })
      if (byCustomerSku.length === 1) {
        const row = byCustomerSku[0]
        return { id: row.id, sku: row.sku, productName: row.productName }
      }
      if (byCustomerSku.length > 1) {
        throw new BadRequestException(
          `客户 SKU「${trimmed}」存在多个匹配，请使用完整系统 SKU（含客户代码前缀）`,
        )
      }
    }

    const omsSql = code
      ? 'SELECT internalSku, customerSku FROM oms_product WHERE (customerSku = ? OR internalSku = ?) AND customerId IN (SELECT id FROM oms_customeraccount WHERE code = ?) LIMIT 1'
      : 'SELECT internalSku, customerSku FROM oms_product WHERE customerSku = ? OR internalSku = ? LIMIT 1'
    const omsParams = code ? [trimmed, trimmed, code] : [trimmed, trimmed]
    const omsRows = await this.prisma.$queryRawUnsafe<Array<{ internalSku: string; customerSku?: string }>>(omsSql, ...omsParams)
    const mappedSku = String(omsRows[0]?.internalSku || '').trim()
    if (mappedSku) {
      const mapped = await this.prisma.product.findUnique({ where: { sku: mappedSku } })
      if (mapped) {
        return { id: mapped.id, sku: mapped.sku, productName: mapped.productName }
      }
    }

    let createSku = mappedSku || trimmed.slice(0, 30)
    let createCustomerSku = inboundCustomerSku({ sku: mappedSku || trimmed, customerSku: omsRows[0]?.customerSku }, code).slice(0, 50)
    if (code && !mappedSku) {
      const siblings = await this.prisma.product.findMany({
        where: { sku: { startsWith: `${code}-` } },
        select: { sku: true },
      })
      createSku = trimmed.toUpperCase().startsWith(`${code}-`)
        ? trimmed.slice(0, 30)
        : buildInternalSku(code, trimmed, siblings.map((row) => row.sku))
    }

    await assertGlobalSkuAvailable(this.prisma, { sku: createSku, customerSku: createCustomerSku, mirrorOmsSku: mappedSku || undefined })
    const created = await this.prisma.product.create({
      data: {
        sku: createSku,
        customerSku: createCustomerSku,
        productName: (productName || trimmed).slice(0, 300),
        category: 'OMS',
        status: 'active',
        syncStatus: 'pending',
        remark: code ? `OMS客户:${code} · OMS 预约入库自动建档` : 'OMS 预约入库自动建档',
      },
    })
    return { id: created.id, sku: created.sku, productName: created.productName }
  }

  private async resolveOmsAsnLines(
    linesInput: OmsAsnLineInput[] | undefined,
    customerCode: string,
  ) {
    const lines = Array.isArray(linesInput) ? linesInput : []
    if (!lines.length) throw new BadRequestException('请填写入库明细')
    const resolved: { productId: bigint; sku: string; qty: number; productName: string; boxNo: number }[] = []
    for (const line of lines) {
      const sku = String(line.sku || '').trim()
      const qty = Math.floor(Number(line.qty ?? 0))
      if (!sku || qty <= 0) throw new BadRequestException('SKU 与入库数量无效')
      const product = await this.ensureProductBySku(sku, line.productName, customerCode)
      let dimensions
      try {
        dimensions = normalizeOmsAsnCustomerDimensions(line)
      } catch (error) {
        throw new BadRequestException(
          `SKU ${sku} 客户尺寸无效：${error instanceof Error ? error.message : String(error)}`,
        )
      }
      if (dimensions) {
        await this.prisma.product.update({
          where: { id: product.id },
          data: dimensions,
        })
      }
      resolved.push({
        productId: product.id,
        sku: product.sku,
        qty,
        productName: product.productName,
        boxNo: Number(line.boxNo) || resolved.length + 1,
      })
    }
    return resolved
  }

  /**
   * OMS submits a row for each carton, so the same SKU can legitimately occur
   * more than once in the payload.  Inbound order items represent products,
   * not cartons: combine those rows before persisting the order item.  Carton
   * rows deliberately continue to use the unmerged source rows.
   */
  private mergeOmsAsnItemsBySku(
    lines: { productId: bigint; sku: string; qty: number; productName: string; boxNo: number }[],
  ) {
    const merged = new Map<string, { productId: bigint; sku: string; qty: number; productName: string; boxNo: number }>()
    for (const line of lines) {
      const key = line.sku.trim().toUpperCase()
      const current = merged.get(key)
      if (!current) {
        merged.set(key, { ...line })
        continue
      }
      if (current.productId !== line.productId) {
        throw new BadRequestException(`SKU ${line.sku} 对应了多个商品档案，不能合并入库明细`)
      }
      current.qty += line.qty
    }
    return [...merged.values()]
  }

  private buildOmsAsnRemark(data: {
    remark?: string
    source?: string
    inboundType?: string
    deliveryMethod?: string
    stockSource?: string
    referenceNo?: string
    eta?: string
    contact?: string
    contactPhone?: string
  }, customerCode: string) {
    return buildInboundRemark({
      customerCode,
      userRemark: data.remark,
      meta: {
        source: data.source?.trim(),
        inboundType: data.inboundType?.trim(),
        deliveryMethod: data.deliveryMethod?.trim(),
        stockSource: data.stockSource?.trim(),
        referenceNo: data.referenceNo?.trim(),
        eta: data.eta?.trim(),
        contact: data.contact?.trim(),
        contactPhone: data.contactPhone?.trim(),
      },
    })
  }

  private async saveOmsAsnAttachments(
    inboundId: bigint,
    attachments?: { fileName: string; contentBase64: string; fileType?: string }[],
  ) {
    if (!Array.isArray(attachments)) return
    for (const att of attachments) {
      if (!att.fileName?.trim() || !att.contentBase64) continue
      const buf = Buffer.from(att.contentBase64, 'base64')
      const { relativePath } = this.files.write(
        'inbound-attachments',
        `${Date.now()}_${att.fileName.trim()}`,
        buf,
      )
      await this.prisma.$executeRawUnsafe(
        'INSERT INTO inbound_attachment (inbound_id, draft_no, file_name, file_path) VALUES (?, ?, ?, ?)',
        Number(inboundId),
        null,
        att.fileName.trim(),
        relativePath,
      )
    }
  }

  /** OMS：客户自发货预报入库（ASN），不扣中转仓库存 */
  async createAsnFromOms(data: {
    inboundNo?: string
    customerCode: string
    warehouseCode?: string
    trackingNo?: string
    remark?: string
    source?: string
    inboundType?: string
    deliveryMethod?: string
    stockSource?: string
    referenceNo?: string
    eta?: string
    contact?: string
    contactPhone?: string
    items: OmsAsnLineInput[]
    attachments?: { fileName: string; contentBase64: string; fileType?: string }[]
  }) {
    const customerCode = String(data.customerCode || '').trim()
    if (!customerCode) throw new BadRequestException('缺少客户编码')
    const customer = await this.prisma.customer.findUnique({ where: { customerCode } })
    if (!customer) throw new NotFoundException(`客户代码 ${customerCode} 不存在`)
    if (customer.status !== 1) throw new BadRequestException('客户已停用')

    const warehouseCode = this.resolveWmsWarehouseCode(String(data.warehouseCode || 'WMS-JHB-01').trim())
    const wh = await this.prisma.warehouse.findUnique({ where: { warehouseCode } })
    if (!wh || wh.warehouseType !== 'wms') {
      throw new BadRequestException(`目的仓 ${warehouseCode} 必须是海外仓（wms）`)
    }

    const inboundNo = String(data.inboundNo || '').trim() || await this.allocateInboundNo(customerCode)
    const existing = await this.prisma.inboundOrder.findUnique({ where: { inboundNo } })
    if (existing) {
      const detail = await this.prisma.inboundOrder.findUnique({
        where: { id: existing.id },
        include: { items: true, cartons: { include: { items: true }, orderBy: { boxSeq: 'asc' } } },
      })
      return { ...this.mapInboundForOms(detail!), idempotent: true }
    }

    const resolved = await this.resolveOmsAsnLines(data.items, customerCode)
    // OMS sends one line per carton.  The warehouse-facing inbound order must
    // keep a single item per SKU, while persistCartons below still retains the
    // original per-carton quantities.
    const inboundItems = this.mergeOmsAsnItemsBySku(resolved)
    const remarkParts = this.buildOmsAsnRemark(data, customerCode)

    const order = await this.prisma.inboundOrder.create({
      data: {
        inboundNo,
        sourceWarehouseCode: null,
        warehouseCode,
        trackingNo: String(data.trackingNo || data.referenceNo || '').trim() || undefined,
        remark: remarkParts,
        omsCustomerCode: customerCode,
        inboundType: data.inboundType?.trim() || null,
        deliveryMethod: data.deliveryMethod?.trim() || null,
        stockSource: data.stockSource?.trim() || null,
        referenceNo: data.referenceNo?.trim() || null,
        eta: data.eta?.trim() || null,
        contact: data.contact?.trim() || null,
        contactPhone: data.contactPhone?.trim() || null,
        status: 'pending_receipt',
        items: {
          create: inboundItems.map((l) => ({
            productId: l.productId,
            sku: l.sku,
            expectedQty: l.qty,
            remark: l.productName,
          })),
        },
      },
      include: { items: true },
    })

    await this.persistCartons(
      this.prisma,
      {
        id: order.id,
        inboundNo: order.inboundNo,
        items: order.items,
      },
      resolved.map((l) => ({
        boxSeq: l.boxNo,
        items: [{ sku: l.sku, qty: l.qty }],
      })),
    )

    await this.saveOmsAsnAttachments(order.id, data.attachments)

    await this.opLog.log({
      module: 'inbound',
      action: 'oms_asn_create',
      targetType: 'inbound_order',
      targetId: inboundNo,
      detail: { customerCode, warehouseCode, itemCount: inboundItems.length },
    })

    const fresh = await this.prisma.inboundOrder.findUnique({
      where: { id: order.id },
      include: { items: true, cartons: { include: { items: true }, orderBy: { boxSeq: 'asc' } } },
    })
    return { ...this.mapInboundForOms(fresh!), idempotent: false }
  }

  private omsAsnPayloadFields(data: {
    customerCode: string
    warehouseCode?: string
    trackingNo?: string
    remark?: string
    source?: string
    inboundType?: string
    deliveryMethod?: string
    stockSource?: string
    referenceNo?: string
    eta?: string
    contact?: string
    contactPhone?: string
    items: OmsAsnLineInput[]
    attachments?: { fileName: string; contentBase64: string; fileType?: string }[]
  }) {
    return data
  }

  /** OMS：在途入库单由客户修改明细，替换 SKU / 外箱后仍保持 pending_receipt */
  async updateAsnFromOms(
    inboundNo: string,
    data: Parameters<InboundService['omsAsnPayloadFields']>[0],
  ) {
    return this.saveOmsAsnRevision(inboundNo, data, 'update')
  }

  /** OMS：已作废入库单由客户确认后重新下单，回到 pending_receipt */
  async reactivateAsnFromOms(
    inboundNo: string,
    data: Parameters<InboundService['omsAsnPayloadFields']>[0],
  ) {
    return this.saveOmsAsnRevision(inboundNo, data, 'reactivate')
  }

  private async saveOmsAsnRevision(
    inboundNo: string,
    data: Parameters<InboundService['omsAsnPayloadFields']>[0],
    mode: 'update' | 'reactivate',
  ) {
    const no = String(inboundNo || '').trim()
    if (!no) throw new BadRequestException('缺少入库单号')
    const customerCode = String(data.customerCode || '').trim()
    if (!customerCode) throw new BadRequestException('缺少客户编码 customerCode')

    const existing = await this.prisma.inboundOrder.findUnique({
      where: { inboundNo: no },
      include: { items: true },
    })
    if (!existing || existing.omsCustomerCode !== customerCode) {
      throw new NotFoundException(`入库单 ${no} 不存在`)
    }
    if (mode === 'reactivate') {
      if (existing.status !== 'cancelled') {
        throw new BadRequestException('仅已作废的入库单可重新下单')
      }
    } else if (!PENDING_RECEIPT_STATUSES.has(existing.status)) {
      throw new BadRequestException('仅在途状态的入库单可由客户修改')
    }
    if (existing.items.some((item) => (item.actualQty ?? 0) > 0)) {
      throw new BadRequestException(
        mode === 'reactivate' ? '已开始收货的入库单不可重新下单' : '已开始收货的入库单不可由客户修改',
      )
    }

    const warehouseCode = this.resolveWmsWarehouseCode(String(data.warehouseCode || existing.warehouseCode || 'WMS-JHB-01').trim())
    const wh = await this.prisma.warehouse.findUnique({ where: { warehouseCode } })
    if (!wh || wh.warehouseType !== 'wms') {
      throw new BadRequestException(`目的仓 ${warehouseCode} 必须是海外仓（wms）`)
    }

    const resolved = await this.resolveOmsAsnLines(data.items, customerCode)
    const inboundItems = this.mergeOmsAsnItemsBySku(resolved)
    const remarkParts = this.buildOmsAsnRemark(data, customerCode)

    const order = await this.prisma.$transaction(async (tx) => {
      await tx.inboundCarton.deleteMany({ where: { inboundId: existing.id } })
      await tx.inboundOrderItem.deleteMany({ where: { inboundId: existing.id } })
      const updated = await tx.inboundOrder.update({
        where: { id: existing.id },
        data: {
          warehouseCode,
          trackingNo: String(data.trackingNo || data.referenceNo || '').trim() || null,
          remark: remarkParts,
          inboundType: data.inboundType?.trim() || existing.inboundType,
          deliveryMethod: data.deliveryMethod?.trim() || existing.deliveryMethod,
          stockSource: data.stockSource?.trim() || existing.stockSource,
          referenceNo: data.referenceNo?.trim() || null,
          eta: data.eta?.trim() || null,
          contact: data.contact?.trim() || existing.contact,
          contactPhone: data.contactPhone?.trim() || existing.contactPhone,
          ...(mode === 'reactivate' ? { status: 'pending_receipt' } : {}),
          items: {
            create: inboundItems.map((l) => ({
              productId: l.productId,
              sku: l.sku,
              expectedQty: l.qty,
              remark: l.productName,
            })),
          },
        },
        include: { items: true },
      })
      await this.persistCartons(
        tx as Pick<PrismaService, 'inboundCarton' | 'inboundCartonItem'>,
        {
          id: updated.id,
          inboundNo: updated.inboundNo,
          items: updated.items,
        },
        resolved.map((l) => ({
          boxSeq: l.boxNo,
          items: [{ sku: l.sku, qty: l.qty }],
        })),
        { replace: true },
      )
      return updated
    })

    await this.saveOmsAsnAttachments(order.id, data.attachments)

    await this.opLog.log({
      module: 'inbound',
      action: mode === 'reactivate' ? 'oms_asn_reactivate' : 'oms_asn_update',
      targetType: 'inbound_order',
      targetId: no,
      detail: { customerCode, warehouseCode, itemCount: inboundItems.length },
    })

    await this.pushInboundStatusToOms(no)

    const fresh = await this.prisma.inboundOrder.findUnique({
      where: { id: order.id },
      include: { items: true, cartons: { include: { items: true }, orderBy: { boxSeq: 'asc' } } },
    })
    return this.mapInboundForOms(fresh!)
  }

  /** OMS：客户作废在途入库单，仓库不再收货 */
  async cancelAsnFromOms(inboundNo: string, data: { customerCode: string }) {
    const no = String(inboundNo || '').trim()
    if (!no) throw new BadRequestException('缺少入库单号')
    const customerCode = String(data.customerCode || '').trim()
    if (!customerCode) throw new BadRequestException('缺少客户编码 customerCode')

    const existing = await this.prisma.inboundOrder.findUnique({
      where: { inboundNo: no },
      include: { items: true, cartons: { include: { items: true }, orderBy: { boxSeq: 'asc' } } },
    })
    if (!existing || existing.omsCustomerCode !== customerCode) {
      throw new NotFoundException(`入库单 ${no} 不存在`)
    }
    if (existing.status === 'cancelled') {
      return this.mapInboundForOms(existing)
    }
    if (!PENDING_RECEIPT_STATUSES.has(existing.status)) {
      throw new BadRequestException('仅在途状态的入库单可作废')
    }
    if (existing.items.some((item) => (item.actualQty ?? 0) > 0)) {
      throw new BadRequestException('已开始收货的入库单不可作废')
    }

    await this.prisma.inboundOrder.update({
      where: { id: existing.id },
      data: { status: 'cancelled' },
    })

    await this.opLog.log({
      module: 'inbound',
      action: 'oms_asn_cancel',
      targetType: 'inbound_order',
      targetId: no,
      detail: { customerCode },
    })

    await this.pushInboundStatusToOms(no)

    const fresh = await this.prisma.inboundOrder.findUnique({
      where: { id: existing.id },
      include: { items: true, cartons: { include: { items: true }, orderBy: { boxSeq: 'asc' } } },
    })
    return this.mapInboundForOms(fresh!)
  }

  async listByOmsCustomer(customerCode: string) {
    const code = customerCode.trim()
    if (!code) throw new BadRequestException('缺少客户编码')
    const rows = await this.prisma.inboundOrder.findMany({
      where: { omsCustomerCode: code },
      include: { items: true, cartons: { include: { items: true }, orderBy: { boxSeq: 'asc' } } },
      orderBy: { id: 'desc' },
      take: 200,
    })
    return { items: rows.map((r) => this.mapInboundForOms(r)), total: rows.length }
  }

  async getByInboundNoForOms(inboundNo: string) {
    const no = inboundNo.trim()
    const row = await this.prisma.inboundOrder.findUnique({
      where: { inboundNo: no },
      include: { items: true, cartons: { include: { items: true }, orderBy: { boxSeq: 'asc' } } },
    })
    if (!row) throw new NotFoundException(`入库单 ${no} 不存在`)
    return this.mapInboundForOms(row)
  }

  /** 状态变更后主动推送 OMS（无客户编码则跳过） */
  private async pushInboundStatusToOms(inboundNo: string, strict = false) {
    try {
      const row = await this.prisma.inboundOrder.findUnique({
        where: { inboundNo },
        include: { items: true, cartons: { include: { items: true }, orderBy: { boxSeq: 'asc' } } },
      })
      if (!row) throw new NotFoundException('入库单状态暂无法读取')
      if (!row.omsCustomerCode) return true
      const payload = this.mapInboundForOms(row)
      const statusSent = await notifyOms('inbound.status', row.omsCustomerCode, payload as unknown as Record<string, unknown>)
      if (strict && !statusSent) throw new Error('OMS入库状态待同步')
      if (payload.omsStatus === 'shelved' || payload.omsStatus === 'partial') {
        const inventoryRows = await this.prisma.inventory.findMany({
          where: {
            warehouseCode: row.warehouseCode,
            productId: { in: row.items.map(item => item.productId) },
          },
          select: { productId: true, availableQty: true, lockedQty: true },
        })
        const inventoryByProductId = new Map(
          inventoryRows.map(item => [item.productId.toString(), item]),
        )
        const stockSent = await notifyOms('inventory.changed', row.omsCustomerCode, {
          reason: 'inbound_' + payload.omsStatus,
          inboundNo: row.inboundNo,
          stockSource: 'owned',
          warehouseCode: row.warehouseCode,
          items: row.items.map(item => {
            const inventory = inventoryByProductId.get(item.productId.toString())
            return {
              sku: item.sku,
              availableQty: inventory?.availableQty ?? 0,
              lockedQty: inventory?.lockedQty ?? 0,
              pendingShelvingQty: Math.max(0, Number(item.actualQty ?? 0) - Number(item.putawayQty ?? 0)),
            }
          }),
        })
        if (strict && !stockSent) throw new Error('OMS库存待同步')
      }
      return true
    } catch (err) {
      if (strict) throw err
      console.warn('[inbound] push OMS skipped:', err)
      return false
    }
  }

  /** 把带客户编码的入库状态再推给 OMS（只发 inbound.status）。 */
  async replayOmsStatuses(): Promise<{ inboundNo: string; omsStatus: string; ok: boolean }[]> {
    const rows = await this.prisma.inboundOrder.findMany({
      where: { omsCustomerCode: { not: null } },
      include: { items: true, cartons: { include: { items: true }, orderBy: { boxSeq: 'asc' } } },
      orderBy: { id: 'asc' },
    })
    const out: { inboundNo: string; omsStatus: string; ok: boolean }[] = []
    for (const row of rows) {
      if (!row.omsCustomerCode) continue
      const payload = this.mapInboundForOms(row)
      const ok = await notifyOms(
        'inbound.status',
        row.omsCustomerCode,
        payload as unknown as Record<string, unknown>,
      )
      out.push({ inboundNo: row.inboundNo, omsStatus: String(payload.omsStatus), ok })
    }
    return out
  }
}
