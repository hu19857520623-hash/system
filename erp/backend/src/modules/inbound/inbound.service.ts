import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { FileStoreService } from '../../common/file-store.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { OperationLogService } from '../operation-log/operation-log.service'
import { tryMarkOrderableOnOmsForSkus } from '../pricing/oms-catalog.util'
import { PricingService } from '../pricing/pricing.service'
import { notifyOms } from '../../common/oms-notify.util'
import { fetchOmsInboundRows, mergeInboundPaginate } from './oms-inbound-bridge.util'
import { buildInboundRemark, parseOmsInboundMeta, stripOmsSystemTags } from '../../common/oms-sync-meta.util'
import { resolveBillingDimensions, type ProductDimensionFields } from '../../common/product-dimension.util'
import { parseInboundQcScanInput } from './inbound-qc-scan.util'

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

/** 一步确认（兼容旧接口） */
const LEGACY_CONFIRM_STATUSES = new Set([
  ...PENDING_RECEIPT_STATUSES,
  'receiving',
])

const TERMINAL_STATUSES = new Set(['completed', 'confirmed'])

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
  ) {}

  async list(q: PaginationDto & { status?: string }) {
    const { page, pageSize } = getPagination(q)
    const where: any = {}
    if (q.status) {
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
    const erpItems = rows.map((order) => ({
      ...order,
      id: Number(order.id),
      displayStatus: normalizeInboundStatus(order.status),
      dataSource: order.omsCustomerCode ? 'erp_oms' : 'erp',
      dataSourceLabel: order.omsCustomerCode ? 'ERP·OMS客户' : 'ERP·发运',
      readOnly: false,
      sortKey: order.createdAt.getTime(),
      items: order.items.map((item: any) => this.enrichInboundItem(item, prodMap)),
    }))

    const omsItems = await fetchOmsInboundRows(this.prisma, {
      keyword: q.keyword,
      status: q.status,
    })
    const erpNoSet = new Set(erpItems.map((r) => r.inboundNo))
    const omsOnly = omsItems.filter((r) => !erpNoSet.has(r.inboundNo))

    const { items, total } = mergeInboundPaginate([erpItems, omsOnly], page, pageSize)
    return { items, total, page, pageSize }
  }

  async detail(id: number) {
    const row = await this.prisma.inboundOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true } })
    if (!row) throw new NotFoundException('入库单不存在')

    const productIds = [...new Set(row.items.map((i) => i.productId))]
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } } })
      : []
    const prodMap = new Map(products.map((p) => [Number(p.id), p]))

    const cartons = await this.loadCartons(Number(row.id), row.inboundNo, row.items)

    return {
      ...row,
      id: Number(row.id),
      displayStatus: normalizeInboundStatus(row.status),
      items: row.items.map((item) => this.enrichInboundItem(item, prodMap)),
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
    if (!code) throw new BadRequestException('缺少 customerCode')
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

  private enrichInboundItem(item: any, prodMap: Map<number, any>) {
    const prod = prodMap.get(Number(item.productId))
    const billing = resolveBillingDimensions(prod || {})
    return {
      ...item,
      id: Number(item.id),
      inboundId: item.inboundId != null ? Number(item.inboundId) : undefined,
      productId: Number(item.productId),
      productName: prod?.productName || item.sku,
      spec: prod?.spec || '',
      lengthCm: billing.lengthCm,
      widthCm: billing.widthCm,
      heightCm: billing.heightCm,
      dimensionsSource: billing.source === 'none' ? null : billing.source,
    }
  }

  private findInboundItemByScan(
    order: { items: any[] },
    skuToken: string,
    prodMap: Map<number, { barcode?: string | null }>,
  ) {
    const token = this.normalizeScanToken(skuToken)
    let item = order.items.find((i) => this.normalizeScanToken(i.sku) === token)
    if (item) return item
    item = order.items.find((i) => {
      const barcode = prodMap.get(Number(i.productId))?.barcode
      return barcode && this.normalizeScanToken(barcode) === token
    })
    if (item) return item
    return order.items.find((i) => token.endsWith(this.normalizeScanToken(i.sku))) || null
  }

  async findByInboundNo(inboundNo: string) {
    const row = await this.prisma.inboundOrder.findUnique({ where: { inboundNo }, include: { items: true } })
    if (!row) throw new NotFoundException('入库单不存在')
    return { ...row, id: Number(row.id) }
  }

  async create(data: any, operatorId?: number) {
    const lines: any[] = data.items || []
    if (!lines.length) throw new BadRequestException('请填写入库明细')

    const sourceWarehouseCode = String(data.sourceWarehouseCode || data.logisticsWhCode || '').trim()
    if (!sourceWarehouseCode) throw new BadRequestException('请选择始发物流中转仓')

    const destWarehouseCode = String(data.warehouseCode || '').trim()
    if (!destWarehouseCode) throw new BadRequestException('请选择目的海外仓')

    const sourceWh = await this.prisma.warehouse.findUnique({ where: { warehouseCode: sourceWarehouseCode } })
    if (!sourceWh || sourceWh.warehouseType !== 'logistics') {
      throw new BadRequestException('始发仓必须是物流中转仓')
    }

    const skuTotals = new Map<string, { productId: bigint; qty: number }>()
    for (const line of lines) {
      const sku = String(line.sku || '').trim()
      const qty = Number(line.expectedQty ?? line.qty ?? 0)
      const productId = BigInt(line.productId ?? 0)
      if (!sku || qty <= 0) throw new BadRequestException('SKU 与入库数量无效')
      if (!productId) throw new BadRequestException(`SKU ${sku} 缺少 productId`)
      const prev = skuTotals.get(sku)
      skuTotals.set(sku, { productId, qty: (prev?.qty ?? 0) + qty })
    }

    const inboundNo = data.inboundNo || 'IN-' + Date.now().toString().slice(-8)
    const warehouseNo = String(data.warehouseNo || '').trim() || this.extractWarehouseNo(data.remark) || undefined
    const trackingNo = String(data.trackingNo || '').trim() || undefined

    return this.prisma.$transaction(async (tx) => {
      for (const [sku, { productId, qty }] of skuTotals) {
        const inv = await tx.inventory.findUnique({
          where: { productId_warehouseCode: { productId, warehouseCode: sourceWarehouseCode } },
        })
        const available = inv?.availableQty ?? 0
        if (available < qty) {
          throw new BadRequestException(
            `SKU ${sku} 在中转仓 ${sourceWarehouseCode} 可用 ${available} 件，不足发运 ${qty} 件；请先在物流中转仓完成收货`,
          )
        }
      }

      const order = await tx.inboundOrder.create({
        data: {
          inboundNo,
          sourceWarehouseCode,
          warehouseCode: destWarehouseCode,
          warehouseNo,
          trackingNo,
          remark: data.remark,
          status: 'pending_receipt',
          items: {
            create: lines.map((l) => ({
              productId: BigInt(l.productId ?? 0),
              sku: l.sku ?? '',
              expectedQty: Number(l.expectedQty ?? l.qty ?? 0),
              remark: l.remark,
            })),
          },
        },
        include: { items: true },
      })

      for (const [sku, { productId, qty }] of skuTotals) {
        const inv = await tx.inventory.findUnique({
          where: { productId_warehouseCode: { productId, warehouseCode: sourceWarehouseCode } },
        })
        if (!inv) {
          throw new BadRequestException(`SKU ${sku} 在中转仓 ${sourceWarehouseCode} 无库存记录`)
        }
        const before = inv.totalQty
        const after = before - qty
        await tx.inventory.update({
          where: { id: inv.id },
          data: {
            totalQty: after,
            availableQty: inv.availableQty - qty,
          },
        })
        await tx.inventoryLog.create({
          data: {
            productId,
            sku,
            warehouseCode: sourceWarehouseCode,
            changeType: 'inbound_allocate',
            changeQty: -qty,
            beforeQty: before,
            afterQty: after,
            referenceNo: inboundNo,
            operatorId: operatorId ? BigInt(operatorId) : undefined,
            remark: `发运至海外仓 ${destWarehouseCode}`,
          },
        })
      }

      return { ...order, id: Number(order.id) }
    }).then(async (result) => {
      await this.opLog.log({
        operatorId,
        module: 'inbound',
        action: 'create',
        targetType: 'inbound_order',
        targetId: inboundNo,
        detail: { sourceWarehouseCode, destWarehouseCode, itemCount: lines.length },
      })
      const withItems = await this.prisma.inboundOrder.findUnique({
        where: { id: BigInt(result.id) },
        include: { items: true },
      })
      if (withItems) {
        await this.persistCartons(this.prisma, withItems, data.cartons)
      }

      const freightLines: any[] = data.freightLines || data.catalogSync || []
      if (freightLines.length) {
        await this.pricing.syncFromInbound({
          inboundNo,
          warehouseCode: destWarehouseCode,
          lines: freightLines.map((l: any) => ({
            sku: l.sku,
            productName: l.productName,
            spec: l.spec,
            inboundQty: Number(l.inboundQty ?? l.expectedQty ?? l.qty ?? 0),
            seaFreightPerUnit: Number(l.seaFreightPerUnit ?? l.unitFreight ?? l.seaFreight ?? 0),
            domesticFeePerUnit: Number(l.domesticFeePerUnit ?? l.domesticFee ?? 0),
            costRmb: l.costRmb != null ? Number(l.costRmb) : undefined,
          })).filter((l) => l.sku && l.inboundQty > 0),
        })
      }

      return result
    })
  }

  /** 写入外箱装箱明细（未传则按 SKU 行自动生成一箱） */
  private async persistCartons(
    tx: Pick<PrismaService, 'inboundCarton' | 'inboundCartonItem'>,
    order: { id: bigint; inboundNo: string; items: { id: bigint; productId: bigint; sku: string; expectedQty: number }[] },
    cartonsInput?: { boxCode?: string; boxSeq?: number; items: { sku: string; qty: number }[] }[],
  ) {
    const existing = await tx.inboundCarton.count({ where: { inboundId: order.id } })
    if (existing > 0) return

    const itemBySku = new Map(order.items.map((i) => [String(i.sku).trim().toUpperCase(), i]))
    let cartonsDef = cartonsInput?.filter((c) => c.items?.length)
    if (!cartonsDef?.length) {
      cartonsDef = order.items.map((item, idx) => ({
        boxSeq: idx + 1,
        items: [{ sku: item.sku, qty: item.expectedQty }],
      }))
    }

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
      const boxCode = String(c.boxCode || '').trim() || `${order.inboundNo}-C${String(boxSeq).padStart(3, '0')}`
      await tx.inboundCarton.create({
        data: {
          inboundId: order.id,
          boxCode,
          boxSeq,
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

  private normalizeScanToken(raw: string) {
    return String(raw || '').trim().toUpperCase()
  }

  private async findPendingCarton(inboundId: number, inboundNo: string, scanCode: string) {
    const token = this.normalizeScanToken(scanCode)
    const cartons = await this.prisma.inboundCarton.findMany({
      where: { inboundId: BigInt(inboundId), status: 'pending' },
      include: { items: true },
    })
    if (!cartons.length) return null

    let hit = cartons.find((c) => this.normalizeScanToken(c.boxCode) === token)
    if (!hit) {
      hit = cartons.find((c) => token.includes(this.normalizeScanToken(c.boxCode)))
    }
    if (!hit) {
      const suffix = token.match(/-C\d{3,}$/)
      if (suffix) {
        hit = cartons.find((c) => this.normalizeScanToken(c.boxCode).endsWith(suffix[0]))
      }
    }
    if (!hit && token.startsWith(this.normalizeScanToken(inboundNo))) {
      hit = cartons.find((c) => token === this.normalizeScanToken(c.boxCode))
    }
    return hit || null
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
  async recordReceivedCartonCount(
    id: number,
    body: { receivedCartonCount?: number },
    operatorId?: number,
  ) {
    const count = Math.floor(Number(body.receivedCartonCount))
    if (!Number.isFinite(count) || count <= 0) throw new BadRequestException('实收箱数须大于 0')

    let order = await this.detail(id)
    if (TERMINAL_STATUSES.has(order.status)) throw new BadRequestException('该入库单已完结')
    if (PENDING_RECEIPT_STATUSES.has(order.status)) {
      throw new BadRequestException('请先在「到仓扫描」确认到货')
    }
    if (!['arrived', 'receiving'].includes(order.status)) {
      throw new BadRequestException(`当前状态「${order.status}」不可登记实收箱数`)
    }
    if (order.status === 'arrived') {
      await this.startReceive(id, operatorId)
    }

    await this.prisma.inboundOrder.update({
      where: { id: BigInt(id) },
      data: { receivedCartonCount: count },
    })

    await this.opLog.log({
      operatorId,
      module: 'inbound',
      action: 'receive_carton_count',
      targetType: 'inbound_order',
      targetId: order.inboundNo,
      detail: { receivedCartonCount: count },
    })

    const refreshed = await this.detail(id)
    return {
      message: `实收箱数已登记：${count} 箱`,
      receivedCartonCount: count,
      order: {
        id: refreshed.id,
        inboundNo: refreshed.inboundNo,
        status: refreshed.status,
        displayStatus: refreshed.displayStatus,
        ...this.buildReceiveSummary(refreshed),
      },
    }
  }

  /** 扫外箱标：仅登记箱数，不写入 SKU 实收件数（件数在清点与测量确认） */
  async receiveBox(
    id: number,
    data: { scanCode?: string; qty?: number; cartonCount?: number },
    operatorId?: number,
  ) {
    const code = String(data.scanCode || '').trim()
    if (!code) throw new BadRequestException('请扫描外箱标')

    let order = await this.detail(id)
    if (TERMINAL_STATUSES.has(order.status)) throw new BadRequestException('该入库单已完结')
    if (PENDING_RECEIPT_STATUSES.has(order.status)) {
      throw new BadRequestException('请先在「到仓扫描」确认到货')
    }
    if (order.status === 'arrived') {
      await this.startReceive(id, operatorId)
      order = await this.detail(id)
    }
    if (order.status !== 'receiving') {
      throw new BadRequestException(`当前状态「${order.status}」不可扫箱收货`)
    }

    const carton = await this.findPendingCarton(id, order.inboundNo, code)
    if (!carton) {
      throw new NotFoundException(
        `扫描码 ${code} 未匹配到外箱标。本环节仅确认箱数；SKU 数量（含 1 SKU 一箱 / 一箱多件）请在「清点与测量」扫描确认`,
      )
    }
    return this.receiveOuterCarton(id, carton, operatorId, order.inboundNo)
  }

  private async receiveOuterCarton(
    inboundId: number,
    carton: { id: bigint; boxCode: string; items: { sku: string; qty: number; inboundItemId: bigint | null }[] },
    operatorId: number | undefined,
    inboundNo: string,
  ) {
    const received = await this.prisma.inboundCarton.findUnique({ where: { id: carton.id } })
    if (!received || received.status === 'received') {
      throw new BadRequestException(`外箱 ${carton.boxCode} 已确认，请勿重复扫描`)
    }

    const expectedCartons = await this.prisma.inboundCarton.count({ where: { inboundId: BigInt(inboundId) } })

    await this.prisma.$transaction(async (tx) => {
      await tx.inboundCarton.update({
        where: { id: carton.id },
        data: {
          status: 'received',
          receivedAt: new Date(),
          receivedBy: operatorId ? BigInt(operatorId) : undefined,
        },
      })
      const receivedCount = await tx.inboundCarton.count({
        where: { inboundId: BigInt(inboundId), status: 'received' },
      })
      await tx.inboundOrder.update({
        where: { id: BigInt(inboundId) },
        data: { receivedCartonCount: receivedCount },
      })
    })

    const refreshed = await this.detail(inboundId)
    const summary = this.buildReceiveSummary(refreshed)
    const detailText = carton.items.map((l) => `${l.sku}×${l.qty}`).join('、')
    const receivedCartonCount = refreshed.receivedCartonCount ?? summary.scannedCartonCount

    await this.opLog.log({
      operatorId,
      module: 'inbound',
      action: 'receive_carton',
      targetType: 'inbound_order',
      targetId: inboundNo,
      detail: { boxCode: carton.boxCode, items: carton.items, receivedCartonCount },
    })

    return {
      scanType: 'outer_box' as const,
      message: `[外箱标] ${carton.boxCode} 已确认（实收 ${receivedCartonCount}/${expectedCartons} 箱）${detailText ? ` · ${detailText}` : ''}`,
      increment: 1,
      receivedCartonCount,
      carton: {
        boxCode: carton.boxCode,
        items: carton.items.map((l) => ({ sku: l.sku, qty: l.qty })),
      },
      item: null,
      order: {
        id: refreshed.id,
        inboundNo: refreshed.inboundNo,
        status: refreshed.status,
        displayStatus: refreshed.displayStatus,
        ...summary,
      },
    }
  }

  async startReceive(id: number, operatorId?: number) {
    const order = await this.detail(id)
    if (TERMINAL_STATUSES.has(order.status)) throw new BadRequestException('该入库单已完结')
    if (order.status === 'receiving') return order
    if (order.status !== 'arrived') {
      if (PENDING_RECEIPT_STATUSES.has(order.status)) {
        throw new BadRequestException('请先在「到仓扫描」确认到货后再收货')
      }
      throw new BadRequestException(`当前状态「${order.status}」不可开始收货`)
    }
    const updated = await this.prisma.inboundOrder.update({
      where: { id: BigInt(id) },
      data: {
        status: 'receiving',
        receivedAt: new Date(),
        receivedBy: operatorId ? BigInt(operatorId) : undefined,
      },
      include: { items: true },
    })
    await this.opLog.log({
      operatorId,
      module: 'inbound',
      action: 'start_receive',
      targetType: 'inbound_order',
      targetId: order.inboundNo,
    })
    await this.pushInboundStatusToOms(order.inboundNo)
    return { ...updated, id: Number(updated.id) }
  }

  /** 收货清点时扫描 SKU 标签，校验是否属于本入库单（不写入数量） */
  async scanReceiptLabel(id: number, scanCode: string) {
    const code = String(scanCode || '').trim()
    if (!code) throw new BadRequestException('请扫描或输入 SKU 标签')

    const order = await this.detail(id)
    if (TERMINAL_STATUSES.has(order.status)) throw new BadRequestException('该入库单已完结')
    if (!['arrived', 'receiving'].includes(order.status)) {
      throw new BadRequestException(`当前状态「${order.status}」不可扫描收货标签`)
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

  /** 清点与测量：扫描 SKU 累加实收，可选回写测量机长宽高 */
  async scanQc(
    id: number,
    data: {
      scanCode?: string
      increment?: number
      lengthCm?: number
      widthCm?: number
      heightCm?: number
      clientRequestId?: string
    },
    operatorId?: number,
  ) {
    let parsed: ReturnType<typeof parseInboundQcScanInput>
    try {
      parsed = parseInboundQcScanInput(String(data.scanCode || ''), data.increment, data)
    } catch (error: any) {
      throw new BadRequestException(error?.message || '扫描内容无效')
    }

    const clientRequestId = String(data.clientRequestId || '').trim().slice(0, 100)
    if (clientRequestId) {
      const duplicate = await this.prisma.operationLog.findFirst({
        where: {
          module: 'inbound',
          action: 'scan_qc',
          detail: { path: '$.clientRequestId', equals: clientRequestId },
        },
        orderBy: { id: 'desc' },
      })
      if (duplicate) {
        return {
          message: '该扫码请求已处理，已按最新单据状态恢复',
          increment: 0,
          duplicate: true,
        }
      }
    }

    let order = await this.detail(id)
    if (TERMINAL_STATUSES.has(order.status)) throw new BadRequestException('该入库单已完结')
    if (order.status === 'exception') {
      throw new BadRequestException('入库单处于异常状态，请先放行后再扫描')
    }
    if (PENDING_RECEIPT_STATUSES.has(order.status)) {
      throw new BadRequestException('请先到仓扫描并完成扫箱收货')
    }

    const canCount = QC_STATUSES.has(order.status)
    const canMeasureOnly = PUTAWAY_STATUSES.has(order.status)
    if (!canCount && !canMeasureOnly) {
      throw new BadRequestException(`当前状态「${order.status}」不可扫描清点`)
    }

    const productIds = [...new Set(order.items.map((i) => i.productId))]
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } } })
      : []
    const prodMap = new Map(products.map((p) => [Number(p.id), p]))

    const item = this.findInboundItemByScan(order, parsed.skuToken, prodMap)
    if (!item) {
      throw new NotFoundException(`扫描码 ${parsed.skuToken} 不属于入库单 ${order.inboundNo}`)
    }

    const increment = canCount ? parsed.increment : 0
    const current = item.actualQty ?? 0
    const newActual = canCount ? current + increment : current

    const hasDims = [parsed.lengthCm, parsed.widthCm, parsed.heightCm].every(
      (v) => v != null && Number(v) > 0,
    )

    await this.prisma.$transaction(async (tx) => {
      if (canCount && increment > 0) {
        await tx.inboundOrderItem.update({
          where: { id: item.id },
          data: { actualQty: newActual },
        })
      }
      if (hasDims) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            measuredLengthCm: parsed.lengthCm,
            measuredWidthCm: parsed.widthCm,
            measuredHeightCm: parsed.heightCm,
            measuredAt: new Date(),
          },
        })
      }
    })

    const refreshed = await this.detail(id)
    const line = refreshed.items.find((i) => Number(i.id) === Number(item.id))!
    const summary = this.buildReceiveSummary(refreshed)

    const dimText = hasDims
      ? ` · 体积 ${parsed.lengthCm}×${parsed.widthCm}×${parsed.heightCm} cm`
      : ''

    await this.opLog.log({
      operatorId,
      module: 'inbound',
      action: 'scan_qc',
      targetType: 'inbound_order',
      targetId: order.inboundNo,
      detail: {
        sku: item.sku,
        increment,
        actualQty: line.actualQty ?? newActual,
        lengthCm: parsed.lengthCm,
        widthCm: parsed.widthCm,
        heightCm: parsed.heightCm,
        clientRequestId: clientRequestId || null,
      },
    })

    return {
      message: canCount
        ? `[清点] ${item.sku} +${increment} 件（累计 ${line.actualQty ?? newActual}/${line.expectedQty}）${dimText}`
        : `[测量] ${item.sku} 尺寸已更新${dimText}`,
      sku: line.sku,
      increment,
      expectedQty: line.expectedQty,
      actualQty: line.actualQty ?? newActual,
      remaining: Math.max(0, line.expectedQty - (line.actualQty ?? newActual)),
      itemId: line.id,
      lengthCm: line.lengthCm ?? parsed.lengthCm ?? null,
      widthCm: line.widthCm ?? parsed.widthCm ?? null,
      heightCm: line.heightCm ?? parsed.heightCm ?? null,
      dimensionsSource: line.dimensionsSource ?? (hasDims ? 'measured' : null),
      item: {
        id: line.id,
        sku: line.sku,
        productName: line.productName,
        spec: line.spec,
        expectedQty: line.expectedQty,
        actualQty: line.actualQty ?? newActual,
        remaining: Math.max(0, line.expectedQty - (line.actualQty ?? newActual)),
        lengthCm: line.lengthCm ?? parsed.lengthCm ?? null,
        widthCm: line.widthCm ?? parsed.widthCm ?? null,
        heightCm: line.heightCm ?? parsed.heightCm ?? null,
        dimensionsSource: line.dimensionsSource ?? (hasDims ? 'measured' : null),
      },
      order: {
        id: refreshed.id,
        inboundNo: refreshed.inboundNo,
        status: refreshed.status,
        displayStatus: refreshed.displayStatus,
        ...summary,
      },
    }
  }

  /** 海外仓到仓扫描：pending_receipt → arrived */
  async arrivalScan(data: { scanCode: string; warehouseCode: string }, operatorId?: number) {
    const scanCode = String(data.scanCode || '').trim()
    const warehouseCode = String(data.warehouseCode || '').trim()
    if (!scanCode) throw new BadRequestException('请扫描或输入单号')
    if (!warehouseCode) throw new BadRequestException('请选择操作仓库')

    const wh = await this.prisma.warehouse.findUnique({ where: { warehouseCode } })
    if (!wh || wh.warehouseType !== 'wms') {
      throw new BadRequestException('操作仓库必须是海外仓')
    }

    const order = await this.prisma.inboundOrder.findFirst({
      where: {
        warehouseCode,
        OR: [
          { inboundNo: scanCode },
          { warehouseNo: scanCode },
          { trackingNo: scanCode },
        ],
      },
      include: { items: true },
    })
    if (!order) throw new NotFoundException(`未找到匹配入库单：${scanCode}`)

    let scanType = 'inbound_no'
    if (order.warehouseNo === scanCode) scanType = 'warehouse_no'
    else if (order.trackingNo === scanCode) scanType = 'tracking_no'

    if (order.status === 'arrived') {
      return {
        alreadyScanned: true,
        message: '该入库单已到仓，无需重复扫描',
        order: this.serializeInbound(order),
      }
    }
    if (!PENDING_RECEIPT_STATUSES.has(order.status)) {
      throw new BadRequestException(`入库单 ${order.inboundNo} 当前状态「${order.status}」不可到仓扫描`)
    }

    const now = new Date()
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.inboundOrder.update({
        where: { id: order.id },
        data: {
          status: 'arrived',
          arrivedAt: now,
          arrivedBy: operatorId ? BigInt(operatorId) : undefined,
        },
        include: { items: true },
      })
      await tx.inboundArrivalScan.create({
        data: {
          inboundId: order.id,
          scanCode,
          scanType,
          warehouseCode,
          operatorId: operatorId ? BigInt(operatorId) : undefined,
          scannedAt: now,
        },
      })
      return row
    })

    await this.opLog.log({
      operatorId,
      module: 'inbound',
      action: 'arrival_scan',
      targetType: 'inbound_order',
      targetId: updated.inboundNo,
      detail: { scanCode, warehouseCode },
    })
    await this.pushInboundStatusToOms(updated.inboundNo)

    return {
      alreadyScanned: false,
      message: `${updated.inboundNo} 到仓扫描成功`,
      order: this.serializeInbound(updated),
    }
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

  async qc(id: number, payload: any, operatorId?: number) {
    let order = await this.detail(id)
    if (TERMINAL_STATUSES.has(order.status)) throw new BadRequestException('该入库单已完结')
    if (order.status === 'pending_putaway') return order
    if (!QC_STATUSES.has(order.status) && order.status !== 'receiving') {
      if (PENDING_RECEIPT_STATUSES.has(order.status)) {
        throw new BadRequestException('请先到仓扫描，再提交清点')
      }
      throw new BadRequestException(`当前状态「${order.status}」不可清点`)
    }

    const inputs: any[] = payload?.items || []
    if (!inputs.length) throw new BadRequestException('请提供清点明细')

    const acceptDiff = Boolean(payload?.acceptDiff)
    let hasFail = false
    let hasDiff = false

    for (const input of inputs) {
      const item = order.items.find(
        (i) => String(i.id) === String(input.id ?? input.inboundItemId) || i.sku === input.sku,
      )
      if (!item) throw new BadRequestException(`明细 ${input.id ?? input.sku} 不存在`)

      const actual = Number(input.actualQty ?? item.actualQty ?? item.expectedQty)
      const diff = actual - item.expectedQty
      const qcStatus = String(input.qcStatus || 'pass')
      if (qcStatus === 'fail') hasFail = true
      if (diff !== 0) hasDiff = true

      await this.prisma.inboundOrderItem.update({
        where: { id: item.id },
        data: {
          actualQty: actual,
          diffQty: diff,
          qcStatus,
          qcRemark: input.qcRemark || null,
        },
      })
    }

    let nextStatus: string
    if (hasFail) {
      nextStatus = 'exception'
    } else if (hasDiff && !acceptDiff) {
      nextStatus = 'exception'
    } else {
      nextStatus = 'pending_putaway'
    }

    const updated = await this.prisma.inboundOrder.update({
      where: { id: BigInt(id) },
      data: {
        status: nextStatus,
        qcAt: new Date(),
        qcBy: operatorId ? BigInt(operatorId) : undefined,
      },
      include: { items: true },
    })
    await this.opLog.log({
      operatorId,
      module: 'inbound',
      action: 'qc',
      targetType: 'inbound_order',
      targetId: order.inboundNo,
      detail: { statusAfter: nextStatus, acceptDiff },
    })
    return { ...updated, id: Number(updated.id) }
  }

  async resolveException(id: number, body: { reason?: string }, operatorId?: number) {
    const order = await this.detail(id)
    if (order.status !== 'exception') {
      throw new BadRequestException('仅异常状态的入库单可放行上架')
    }
    const reason = String(body?.reason || '').trim()
    if (reason.length < 2) throw new BadRequestException('请填写不少于 2 个字的异常放行原因')
    const updated = await this.prisma.inboundOrder.update({
      where: { id: BigInt(id) },
      data: { status: 'pending_putaway' },
      include: { items: true },
    })
    await this.opLog.log({
      operatorId,
      module: 'inbound',
      action: 'resolve_exception',
      targetType: 'inbound_order',
      targetId: order.inboundNo,
      detail: { reason },
    })
    return { ...updated, id: Number(updated.id) }
  }

  async measureDimensions(id: number, payload: any, operatorId?: number) {
    const order = await this.detail(id)
    if (TERMINAL_STATUSES.has(order.status)) throw new BadRequestException('该入库单已完结')
    if (!PUTAWAY_STATUSES.has(order.status)) {
      throw new BadRequestException(`当前状态「${order.status}」不可测量，请先完成清点`)
    }

    const groups: any[] = payload?.items || []
    if (!groups.length) throw new BadRequestException('请提供测量明细')

    const itemMap = new Map(order.items.map((i) => [Number(i.id), i]))

    await this.prisma.$transaction(async (tx) => {
      for (const group of groups) {
        const inboundItemId = Number(group.inboundItemId ?? group.id)
        const item = itemMap.get(inboundItemId)
        if (!item) throw new BadRequestException(`明细 ${inboundItemId} 不存在`)

        const lengthCm = Number(group.lengthCm)
        const widthCm = Number(group.widthCm)
        const heightCm = Number(group.heightCm)
        if (![lengthCm, widthCm, heightCm].every((v) => Number.isFinite(v) && v > 0)) {
          throw new BadRequestException(`${item.sku} 请填写有效的长宽高（cm）`)
        }

        await tx.product.update({
          where: { id: item.productId },
          data: {
            measuredLengthCm: lengthCm,
            measuredWidthCm: widthCm,
            measuredHeightCm: heightCm,
            measuredAt: new Date(),
          },
        })
      }
    })

    for (const group of groups) {
      const lengthCm = Number(group.lengthCm)
      const widthCm = Number(group.widthCm)
      const heightCm = Number(group.heightCm)
      const inboundItemId = Number(group.inboundItemId ?? group.id)
      const item = itemMap.get(inboundItemId)
      if (!item) continue
      await this.opLog.log({
        operatorId,
        module: 'product',
        action: 'dimension_measure',
        targetType: 'product',
        targetId: item.sku,
        detail: {
          message: `入库测量：长 ${lengthCm} × 宽 ${widthCm} × 高 ${heightCm} cm`,
          inboundNo: order.inboundNo,
          lengthCm,
          widthCm,
          heightCm,
        },
      })
    }

    return this.detail(id)
  }

  async putaway(id: number, payload: any, operatorId?: number) {
    const order = await this.detail(id)
    if (TERMINAL_STATUSES.has(order.status)) throw new BadRequestException('该入库单已完结')
    if (!PUTAWAY_STATUSES.has(order.status)) {
      throw new BadRequestException(`当前状态「${order.status}」不可上架，请先完成清点`)
    }

    const groups: any[] = payload?.items || []
    if (!groups.length) throw new BadRequestException('请提供上架明细')

    const itemMap = new Map(order.items.map((i) => [Number(i.id), i]))

    return this.prisma.$transaction(async (tx) => {
      for (const group of groups) {
        const inboundItemId = Number(group.inboundItemId ?? group.id)
        const item = itemMap.get(inboundItemId)
        if (!item) throw new BadRequestException(`明细 ${inboundItemId} 不存在`)

        const targetQty = item.actualQty ?? item.expectedQty
        const alreadyPutaway = item.putawayQty ?? 0
        const lines: { locationCode: string; qty: number }[] = group.lines?.length
          ? group.lines.map((l: any) => ({ locationCode: String(l.locationCode), qty: Number(l.qty) }))
          : [{ locationCode: String(group.locationCode), qty: Number(group.qty) }]

        let batchQty = 0
        for (const line of lines) {
          if (!line.locationCode || !line.qty || line.qty <= 0) {
            throw new BadRequestException('库位与数量无效')
          }
          batchQty += line.qty

          const locCode = String(line.locationCode || '').trim()
          const locCodeUpper = locCode.toUpperCase()
          const loc = await tx.warehouseLocation.findFirst({
            where: {
              warehouseCode: order.warehouseCode,
              locationCode: locCodeUpper,
              status: 'available',
            },
          }) ?? (locCode !== locCodeUpper
            ? await tx.warehouseLocation.findFirst({
                where: {
                  warehouseCode: order.warehouseCode,
                  locationCode: locCode,
                  status: 'available',
                },
              })
            : null)
          if (!loc) throw new BadRequestException(`库位 ${line.locationCode} 不可用或不存在`)

          await tx.inboundPutawayItem.create({
            data: {
              inboundId: BigInt(id),
              inboundItemId: BigInt(inboundItemId),
              locationId: loc.id,
              locationCode: loc.locationCode,
              qty: line.qty,
              operatorId: operatorId ? BigInt(operatorId) : undefined,
            },
          })

          const invLoc = await tx.inventoryLocation.findFirst({
            where: { productId: item.productId, locationId: loc.id, batchNo: null },
          })
          if (invLoc) {
            await tx.inventoryLocation.update({
              where: { id: invLoc.id },
              data: { qty: invLoc.qty + line.qty, inboundNo: order.inboundNo },
            })
          } else {
            await tx.inventoryLocation.create({
              data: {
                productId: item.productId,
                sku: item.sku,
                warehouseCode: order.warehouseCode,
                locationId: loc.id,
                locationCode: loc.locationCode,
                qty: line.qty,
                inboundNo: order.inboundNo,
              },
            })
          }

          const whInv = await tx.inventory.findUnique({
            where: { productId_warehouseCode: { productId: item.productId, warehouseCode: order.warehouseCode } },
          })
          const before = whInv?.totalQty ?? 0
          const after = before + line.qty
          if (whInv) {
            await tx.inventory.update({
              where: { id: whInv.id },
              data: { totalQty: after, availableQty: whInv.availableQty + line.qty },
            })
          } else {
            await tx.inventory.create({
              data: {
                productId: item.productId,
                sku: item.sku,
                warehouseCode: order.warehouseCode,
                totalQty: after,
                availableQty: after,
              },
            })
          }
          await tx.inventoryLog.create({
            data: {
              productId: item.productId,
              sku: item.sku,
              warehouseCode: order.warehouseCode,
              changeType: 'putaway',
              changeQty: line.qty,
              beforeQty: before,
              afterQty: after,
              referenceNo: order.inboundNo,
              operatorId: operatorId ? BigInt(operatorId) : undefined,
              remark: loc.locationCode,
            },
          })
        }

        if (alreadyPutaway + batchQty > targetQty) {
          throw new BadRequestException(`${item.sku} 上架数量超出实收`)
        }
        await tx.inboundOrderItem.update({
          where: { id: item.id },
          data: { putawayQty: alreadyPutaway + batchQty },
        })
        item.putawayQty = alreadyPutaway + batchQty

        let lengthCm = Number(group.lengthCm)
        let widthCm = Number(group.widthCm)
        let heightCm = Number(group.heightCm)
        if (![lengthCm, widthCm, heightCm].every((v) => Number.isFinite(v) && v > 0)) {
          const product = await tx.product.findUnique({ where: { id: item.productId } })
          lengthCm = Number(product?.measuredLengthCm ?? product?.lengthCm)
          widthCm = Number(product?.measuredWidthCm ?? product?.widthCm)
          heightCm = Number(product?.measuredHeightCm ?? product?.heightCm)
        }
        if (![lengthCm, widthCm, heightCm].every((v) => Number.isFinite(v) && v > 0)) {
          throw new BadRequestException(`${item.sku} 上架前须先完成体积测量（长宽高 cm）`)
        }
        if (group.lengthCm != null || group.widthCm != null || group.heightCm != null) {
          await tx.product.update({
            where: { id: item.productId },
            data: {
              measuredLengthCm: lengthCm,
              measuredWidthCm: widthCm,
              measuredHeightCm: heightCm,
              measuredAt: new Date(),
            },
          })
        }
      }

      const refreshedItems = await tx.inboundOrderItem.findMany({ where: { inboundId: BigInt(id) } })
      const allDone = refreshedItems.every((i) => (i.putawayQty ?? 0) >= (i.actualQty ?? i.expectedQty))

      const updated = await tx.inboundOrder.update({
        where: { id: BigInt(id) },
        data: allDone
          ? {
              status: 'completed',
              putawayAt: new Date(),
              putawayBy: operatorId ? BigInt(operatorId) : undefined,
              confirmedAt: new Date(),
              confirmedBy: operatorId ? BigInt(operatorId) : undefined,
            }
          : {},
        include: { items: true },
      })
      return { ...updated, id: Number(updated.id), allDone }
    }).then(async (result) => {
      if (result.allDone) {
        const skus = result.items.map((i: { sku: string }) => i.sku).filter(Boolean)
        try {
          await tryMarkOrderableOnOmsForSkus(this.prisma, skus)
        } catch (err) {
          console.warn('[putaway] OMS orderable sync skipped:', err)
        }
      }
      for (const group of groups) {
        const lengthCm = Number(group.lengthCm)
        const widthCm = Number(group.widthCm)
        const heightCm = Number(group.heightCm)
        if (![lengthCm, widthCm, heightCm].every((v) => Number.isFinite(v) && v > 0)) continue
        const inboundItemId = Number(group.inboundItemId ?? group.id)
        const item = itemMap.get(inboundItemId)
        if (!item) continue
        await this.opLog.log({
          operatorId,
          module: 'product',
          action: 'dimension_measure',
          targetType: 'product',
          targetId: item.sku,
          detail: {
            message: `入库上架测量：长 ${lengthCm} × 宽 ${widthCm} × 高 ${heightCm} cm`,
            inboundNo: order.inboundNo,
            lengthCm,
            widthCm,
            heightCm,
          },
        })
      }
      await this.opLog.log({
        operatorId,
        module: 'inbound',
        action: 'putaway',
        targetType: 'inbound_order',
        targetId: order.inboundNo,
        detail: { allDone: result.allDone, lineCount: groups.length },
      })
      await this.pushInboundStatusToOms(order.inboundNo)
      return result
    })
  }

  /** 兼容旧前端：清点 + 默认待上架区一键入库 */
  async confirm(id: number, payload: any, operatorId?: number) {
    const order = await this.detail(id)
    if (TERMINAL_STATUSES.has(order.status)) throw new BadRequestException('该入库单已确认')

    if (order.status === 'pending_putaway') {
      return this.putawayToDefaultStaging(id, operatorId)
    }

    if (!LEGACY_CONFIRM_STATUSES.has(order.status) && order.status !== 'exception') {
      throw new BadRequestException(`当前状态「${order.status}」不可确认入库`)
    }

    if (order.status === 'exception') {
      await this.resolveException(id, { reason: String(payload?.reason || '旧流程确认放行') }, operatorId)
    } else {
      await this.qc(id, { ...payload, acceptDiff: true }, operatorId)
    }
    return this.putawayToDefaultStaging(id, operatorId)
  }

  private async putawayToDefaultStaging(id: number, operatorId?: number) {
    const order = await this.detail(id)
    if (!PUTAWAY_STATUSES.has(order.status) && !TERMINAL_STATUSES.has(order.status)) {
      throw new BadRequestException('入库单未进入待上架状态')
    }
    if (TERMINAL_STATUSES.has(order.status)) return order

    const staging = await this.prisma.warehouseLocation.findFirst({
      where: {
        warehouseCode: order.warehouseCode,
        OR: [
          { locationCode: 'STAGE-01' },
          { zone: { zoneType: 'staging' } },
        ],
        status: 'available',
      },
      orderBy: { locationCode: 'asc' },
    })
    if (!staging) {
      throw new BadRequestException(`仓库 ${order.warehouseCode} 未配置待上架区库位（STAGE-01）`)
    }

    const items = order.items.map((item: any) => {
      const lengthCm = item.lengthCm != null ? Number(item.lengthCm) : null
      const widthCm = item.widthCm != null ? Number(item.widthCm) : null
      const heightCm = item.heightCm != null ? Number(item.heightCm) : null
      if (![lengthCm, widthCm, heightCm].every((v) => v != null && v > 0)) {
        throw new BadRequestException(`SKU ${item.sku} 尚未测量长宽高，请先在「到仓扫描 → 清点与测量」填写实测尺寸`)
      }
      return {
        inboundItemId: Number(item.id),
        lengthCm,
        widthCm,
        heightCm,
        lines: [{ locationCode: staging.locationCode, qty: item.actualQty ?? item.expectedQty }],
      }
    })
    return this.putaway(id, { items }, operatorId)
  }

  // ── 草稿 ──

  async listDrafts(operatorId?: number) {
    const rows: any[] = operatorId
      ? await this.prisma.$queryRawUnsafe(
          'SELECT draft_no as draftNo, form_data as formData, saved_at as savedAt FROM inbound_draft WHERE operator_id = ? ORDER BY saved_at DESC',
          operatorId,
        )
      : await this.prisma.$queryRawUnsafe(
          'SELECT draft_no as draftNo, form_data as formData, saved_at as savedAt FROM inbound_draft ORDER BY saved_at DESC',
        )
    return rows.map((r) => ({
      id: r.draftNo,
      draftNo: r.draftNo,
      savedAt: r.savedAt,
      _form: typeof r.formData === 'string' ? JSON.parse(r.formData) : r.formData,
    }))
  }

  async saveDraft(draftNo: string, formData: any, operatorId?: number) {
    const json = JSON.stringify(formData)
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO inbound_draft (draft_no, operator_id, form_data) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE form_data = VALUES(form_data), saved_at = CURRENT_TIMESTAMP`,
      draftNo,
      operatorId ?? null,
      json,
    )
    return { draftNo, savedAt: new Date() }
  }

  async deleteDraft(draftNo: string) {
    await this.prisma.$executeRawUnsafe('DELETE FROM inbound_draft WHERE draft_no = ?', draftNo)
    return { ok: true }
  }

  async uploadAttachment(data: { inboundId?: number; draftNo?: string; fileName: string; contentBase64: string }) {
    const buf = Buffer.from(data.contentBase64, 'base64')
    const { relativePath } = this.files.write('inbound-attachments', `${Date.now()}_${data.fileName}`, buf)
    await this.prisma.$executeRawUnsafe(
      'INSERT INTO inbound_attachment (inbound_id, draft_no, file_name, file_path) VALUES (?, ?, ?, ?)',
      data.inboundId ?? null,
      data.draftNo ?? null,
      data.fileName,
      relativePath,
    )
    return { fileName: data.fileName, path: relativePath }
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
    const blocks = items.map((item: any) => `
      <div style="width:50mm;height:30mm;border:1px solid #000;padding:4mm;font-family:Arial,sans-serif;page-break-after:always">
        <div style="font-size:10px;font-weight:bold">${order.inboundNo}</div>
        <div style="font-size:14px;font-weight:bold;margin:2mm 0">${item.sku}</div>
        <div style="font-size:9px">${item.productName || ''}</div>
        <div style="font-size:9px;margin-top:2mm">Qty: ${item.expectedQty}</div>
      </div>`).join('')
    return `<!DOCTYPE html><html><body>${blocks}</body></html>`
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
    const html = this.buildSkuLabelHtml(order, sku)
    const fileName = `SKU标签_${order.inboundNo}.html`
    this.files.write('labels', fileName, html)
    const printDelta = (order.items || [])
      .filter((i: any) => !sku || i.sku === sku)
      .reduce((s: number, i: any) => s + Number(i.expectedQty || 0), 0)
    await this.prisma.inboundOrder.update({
      where: { id: BigInt(id) },
      data: { labelPrintCount: { increment: Math.max(printDelta, 1) } },
    })
    return { fileName, content: Buffer.from(html, 'utf-8'), mimeType: 'text/html;charset=utf-8' }
  }

  async getOuterLabel(id: number) {
    const order = await this.detail(id)
    const html = this.buildOuterLabelHtml(order)
    const fileName = `外箱标_${order.inboundNo}.html`
    this.files.write('labels', fileName, html)
    await this.prisma.inboundOrder.update({
      where: { id: BigInt(id) },
      data: { labelPrintCount: { increment: order.cartons?.length || 1 } },
    })
    return { fileName, content: Buffer.from(html, 'utf-8'), mimeType: 'text/html;charset=utf-8' }
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
  }) {
    const displayStatus = normalizeInboundStatus(order.status)
    const items = (order.items || []).map((i) => ({
      sku: i.sku,
      expectedQty: i.expectedQty,
      receivedQty: i.actualQty ?? 0,
      productId: Number(i.productId),
      productName: i.remark || i.sku,
    }))
    const meta = parseOmsInboundMeta(order.remark)
    return {
      id: Number(order.id),
      inboundNo: order.inboundNo,
      warehouseCode: order.warehouseCode,
      trackingNo: order.trackingNo,
      status: order.status,
      displayStatus,
      omsStatus: this.toOmsInboundStatus(displayStatus),
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
      totalExpectedQty: items.reduce((s, i) => s + i.expectedQty, 0),
      totalReceivedQty: items.reduce((s, i) => s + i.receivedQty, 0),
      items,
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
  ): Promise<{ id: bigint; sku: string; productName: string }> {
    const trimmed = sku.trim()
    const existing = await this.prisma.product.findUnique({ where: { sku: trimmed } })
    if (existing) {
      return { id: existing.id, sku: existing.sku, productName: existing.productName }
    }
    const byCustomerSku = await this.prisma.product.findFirst({ where: { customerSku: trimmed } })
    if (byCustomerSku) {
      return { id: byCustomerSku.id, sku: byCustomerSku.sku, productName: byCustomerSku.productName }
    }
    const omsRows = await this.prisma.$queryRawUnsafe<Array<{ internalSku: string }>>(
      'SELECT internalSku FROM oms_Product WHERE customerSku = ? OR internalSku = ? LIMIT 1',
      trimmed,
      trimmed,
    )
    const mappedSku = String(omsRows[0]?.internalSku || '').trim()
    if (mappedSku) {
      const mapped = await this.prisma.product.findUnique({ where: { sku: mappedSku } })
      if (mapped) {
        return { id: mapped.id, sku: mapped.sku, productName: mapped.productName }
      }
    }
    const created = await this.prisma.product.create({
      data: {
        sku: trimmed.slice(0, 30),
        customerSku: trimmed.slice(0, 50),
        productName: (productName || trimmed).slice(0, 300),
        category: 'OMS',
        status: 'active',
        syncStatus: 'pending',
        remark: 'OMS 预约入库自动建档',
      },
    })
    return { id: created.id, sku: created.sku, productName: created.productName }
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
    items: { sku: string; qty: number; productName?: string; boxNo?: number }[]
    attachments?: { fileName: string; contentBase64: string; fileType?: string }[]
  }) {
    const customerCode = String(data.customerCode || '').trim()
    if (!customerCode) throw new BadRequestException('缺少客户编码 customerCode')
    const customer = await this.prisma.customer.findUnique({ where: { customerCode } })
    if (!customer) throw new NotFoundException(`客户代码 ${customerCode} 不存在`)
    if (customer.status !== 1) throw new BadRequestException('客户已停用')

    const lines = Array.isArray(data.items) ? data.items : []
    if (!lines.length) throw new BadRequestException('请填写入库明细')

    const warehouseCode = this.resolveWmsWarehouseCode(String(data.warehouseCode || 'WMS-JHB-01').trim())
    const wh = await this.prisma.warehouse.findUnique({ where: { warehouseCode } })
    if (!wh || wh.warehouseType !== 'wms') {
      throw new BadRequestException(`目的仓 ${warehouseCode} 必须是海外仓（wms）`)
    }

    const inboundNo = String(data.inboundNo || '').trim() || `IN-OMS-${Date.now().toString().slice(-8)}`
    const existing = await this.prisma.inboundOrder.findUnique({ where: { inboundNo } })
    if (existing) {
      const detail = await this.prisma.inboundOrder.findUnique({
        where: { id: existing.id },
        include: { items: true },
      })
      return { ...this.mapInboundForOms(detail!), idempotent: true }
    }

    const resolved: { productId: bigint; sku: string; qty: number; productName: string; boxNo: number }[] = []
    for (const line of lines) {
      const sku = String(line.sku || '').trim()
      const qty = Math.floor(Number(line.qty ?? 0))
      if (!sku || qty <= 0) throw new BadRequestException('SKU 与入库数量无效')
      const product = await this.ensureProductBySku(sku, line.productName)
      resolved.push({
        productId: product.id,
        sku: product.sku,
        qty,
        productName: product.productName,
        boxNo: Number(line.boxNo) || resolved.length + 1,
      })
    }

    const remarkParts = buildInboundRemark({
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
          create: resolved.map((l) => ({
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

    if (Array.isArray(data.attachments)) {
      for (const att of data.attachments) {
        if (!att.fileName?.trim() || !att.contentBase64) continue
        const buf = Buffer.from(att.contentBase64, 'base64')
        const { relativePath } = this.files.write(
          'inbound-attachments',
          `${Date.now()}_${att.fileName.trim()}`,
          buf,
        )
        await this.prisma.$executeRawUnsafe(
          'INSERT INTO inbound_attachment (inbound_id, draft_no, file_name, file_path) VALUES (?, ?, ?, ?)',
          Number(order.id),
          null,
          att.fileName.trim(),
          relativePath,
        )
      }
    }

    await this.opLog.log({
      module: 'inbound',
      action: 'oms_asn_create',
      targetType: 'inbound_order',
      targetId: inboundNo,
      detail: { customerCode, warehouseCode, itemCount: resolved.length },
    })

    const fresh = await this.prisma.inboundOrder.findUnique({
      where: { id: order.id },
      include: { items: true },
    })
    return { ...this.mapInboundForOms(fresh!), idempotent: false }
  }

  async listByOmsCustomer(customerCode: string) {
    const code = customerCode.trim()
    if (!code) throw new BadRequestException('缺少客户编码')
    const rows = await this.prisma.inboundOrder.findMany({
      where: { omsCustomerCode: code },
      include: { items: true },
      orderBy: { id: 'desc' },
      take: 200,
    })
    return { items: rows.map((r) => this.mapInboundForOms(r)), total: rows.length }
  }

  async getByInboundNoForOms(inboundNo: string) {
    const no = inboundNo.trim()
    const row = await this.prisma.inboundOrder.findUnique({
      where: { inboundNo: no },
      include: { items: true },
    })
    if (!row) throw new NotFoundException(`入库单 ${no} 不存在`)
    return this.mapInboundForOms(row)
  }

  /** 状态变更后主动推送 OMS（无客户编码则跳过） */
  private async pushInboundStatusToOms(inboundNo: string) {
    try {
      const row = await this.prisma.inboundOrder.findUnique({
        where: { inboundNo },
        include: { items: true },
      })
      if (!row?.omsCustomerCode) return
      const payload = this.mapInboundForOms(row)
      void notifyOms('inbound.status', row.omsCustomerCode, payload as unknown as Record<string, unknown>)
      if (payload.omsStatus === 'shelved' || payload.omsStatus === 'partial') {
        void notifyOms('inventory.changed', row.omsCustomerCode, {
          reason: 'inbound_' + payload.omsStatus,
          inboundNo: row.inboundNo,
        })
      }
    } catch (err) {
      console.warn('[inbound] push OMS skipped:', err)
    }
  }

  /** 把带客户编码的入库状态再推给 OMS（只发 inbound.status）。 */
  async replayOmsStatuses(): Promise<{ inboundNo: string; omsStatus: string; ok: boolean }[]> {
    const rows = await this.prisma.inboundOrder.findMany({
      where: { omsCustomerCode: { not: null } },
      include: { items: true },
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
