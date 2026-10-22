import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { CreateLogisticsReceiptDto } from './logistics-receipt.dto'
import { logisticsReceiptNumber, logisticsReceiptRequest, receiptRequestMetadata, receiptStoredRemark } from './logistics-receipt-request.util'
import { logisticsReceiptProgress } from './logistics-receipt-progress.util'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { OperationLogService } from '../operation-log/operation-log.service'

function fmtTime(d: Date | null | undefined): string {
  if (!d) return ''
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

@Injectable()
export class LogisticsReceiptService {
  constructor(
    private prisma: PrismaService,
    private opLog: OperationLogService,
  ) {}

  private serializeReceipt(row: any) {
    const metadata = receiptRequestMetadata(row.remark)
    return {
      id: Number(row.id),
      receiptNo: row.receiptNo,
      poId: Number(row.poId),
      poNo: row.poNo,
      warehouseCode: row.warehouseCode,
      operatorName: row.operatorName || '',
      remark: metadata?.request.remark ?? row.remark ?? '',
      clientRequestId: metadata?.clientRequestId || null,
      receivedAt: fmtTime(row.receivedAt),
      items: (row.items || []).map((i: any) => ({
        id: Number(i.id),
        sku: i.sku,
        productName: i.productName || '',
        expectedQty: i.expectedQty,
        actualQty: i.actualQty,
        damagedQty: i.damagedQty ?? 0,
        qcStatus: i.qcStatus || 'pass',
        qcRemark: i.qcRemark || '',
      })),
    }
  }

  /** 待收货 PO：财务已批、尚未全部入物流仓 */
  async listPendingPos(warehouseCode?: string) {
    const pos = await this.prisma.purchaseOrder.findMany({
      where: {
        status: { in: ['finance_approved', 'at_logistics_wh', 'approved'] },
        ...(warehouseCode ? { warehouseCode } : {}),
      },
      include: { items: true },
      orderBy: { id: 'desc' },
    })
    const supplierIds = [...new Set(pos.map((p) => p.supplierId))]
    const suppliers = supplierIds.length
      ? await this.prisma.supplier.findMany({ where: { id: { in: supplierIds } } })
      : []
    const supMap = new Map(suppliers.map((s) => [Number(s.id), s.supplierName]))

    const productIds = [...new Set(pos.flatMap((p) => p.items.map((i) => i.productId)))]
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, productName: true, spec: true },
        })
      : []
    const prodMap = new Map(products.map((p) => [Number(p.id), p]))
    const receipts = pos.length ? await this.prisma.logisticsReceipt.findMany({ where: { poId: { in: pos.map(po => po.id) } }, include: { items: { orderBy: { id: 'asc' } } } }) : []

    return pos
      .map((po) => {
        const progress = logisticsReceiptProgress(po.items, receipts.filter(receipt => receipt.poId === po.id))
        const pendingItems = progress.items.filter(item => item.pendingQty > 0)
        if (!pendingItems.length && !progress.issues.length) return null
        return {
          id: Number(po.id),
          poNo: po.poNo,
          supplier: supMap.get(Number(po.supplierId)) || '—',
          warehouseCode: po.warehouseCode || '',
          skuCount: pendingItems.length,
          receiptIssue: progress.issues.join('；'),
          amount: Number(po.totalAmount),
          expectedArrival: po.expectedArrival
            ? po.expectedArrival.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
            : '—',
          // 待收货列表只返回仍有待收数量的 SKU，避免已收完的 SKU 误显示为待收。
          lines: pendingItems.map((i) => {
            const prod = prodMap.get(Number(i.productId))
            return {
              id: Number(i.id),
              productId: Number(i.productId),
              sku: i.sku,
              name: i.productName || prod?.productName || i.sku,
              spec: prod?.spec || '',
              quantity: i.quantity,
              receivedQty: i.receivedQty,
              damagedQty: i.damagedQty,
              pendingQty: i.pendingQty,
              unitPrice: Number(i.unitPrice),
            }
          }),
        }
      })
      .filter(Boolean)
  }

  async list(q: PaginationDto & { warehouseCode?: string }) {
    const { page, pageSize } = getPagination(q, 50)
    const where: any = {}
    if (q.warehouseCode && q.warehouseCode !== 'all') where.warehouseCode = q.warehouseCode
    if (q.keyword) {
      where.OR = [{ receiptNo: { contains: q.keyword } }, { poNo: { contains: q.keyword } }]
    }
    const [rows, total] = await Promise.all([
      this.prisma.logisticsReceipt.findMany({
        where,
        include: { items: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'desc' },
      }),
      this.prisma.logisticsReceipt.count({ where }),
    ])
    return { items: rows.map((r) => this.serializeReceipt(r)), total, page, pageSize }
  }

  /** Explicit maintenance command; ordinary list reads never mutate historical data. */
  async reconcileDamagedReceipts(apply = false) {
    const damaged = await this.prisma.logisticsReceipt.findMany({ where: { items: { some: { damagedQty: { gt: 0 } } } }, select: { poId: true } })
    const results: Array<{ poId: number; poNo?: string; changed: boolean; applied?: boolean; issues: string[]; status?: string; lines?: { poItemId: number; receivedQty: number; damagedQty: number }[] }> = []
    for (const poId of [...new Set(damaged.map(receipt => receipt.poId))]) {
      results.push(await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM purchase_order WHERE id = ${poId} FOR UPDATE`
        const po = await tx.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true } })
        if (!po || !['finance_approved', 'at_logistics_wh', 'approved', 'received'].includes(po.status)) return { poId: Number(poId), changed: false, issues: ['采购状态不属于可核对范围'] }
        const receipts = await tx.logisticsReceipt.findMany({ where: { poId }, include: { items: { orderBy: { id: 'asc' } } } })
        const progress = logisticsReceiptProgress(po.items, receipts)
        const changes = progress.items.filter(item => item.receivedQty !== po.items.find(original => original.id === item.id)!.receivedQty)
        const status = progress.allReceived ? 'received' : progress.items.some(item => item.receivedQty > 0) ? 'at_logistics_wh' : po.status
        const changed = !progress.issues.length && (changes.length > 0 || status !== po.status)
        if (apply && changed) {
          for (const item of changes) await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQty: item.receivedQty } })
          await tx.purchaseOrder.update({ where: { id: po.id }, data: { status } })
          await tx.operationLog.create({ data: { module: 'logistics_receipt', action: 'repair_damage_received', targetType: 'purchase_order', targetId: po.poNo,
            detail: { message: '按原收货记录补齐破损已收数量，库存保持不变', fromStatus: po.status, toStatus: status,
              lines: changes.map(item => ({ poItemId: Number(item.id), receivedQty: item.receivedQty, damagedQty: item.damagedQty })) } } })
        }
        return { poId: Number(po.id), poNo: po.poNo, changed, applied: apply && changed, issues: progress.issues, status,
          lines: changes.map(item => ({ poItemId: Number(item.id), receivedQty: item.receivedQty, damagedQty: item.damagedQty })) }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }))
    }
    return { apply, affectedOrders: results.filter(result => result.changed).length, results }
  }

  async create(data: CreateLogisticsReceiptDto, operatorName?: string, operatorId?: number) {
    // Validate before converting identifiers to BigInt, including callers outside the HTTP DTO.
    logisticsReceiptRequest(data, String(data.warehouseCode || '').trim())
    const receiptNo = logisticsReceiptNumber(data)
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM purchase_order WHERE id = ${BigInt(data.poId)} FOR UPDATE`
      const po = await tx.purchaseOrder.findUnique({ where: { id: BigInt(data.poId) }, include: { items: true } })
      if (!po) throw new NotFoundException('采购单不存在')
      const warehouseCode = String(data.warehouseCode || po.warehouseCode || '').trim()
      const request = logisticsReceiptRequest(data, warehouseCode)
      const existing = await tx.logisticsReceipt.findUnique({ where: { receiptNo }, include: { items: { orderBy: { id: 'asc' } } } })
      if (existing) {
        const metadata = receiptRequestMetadata(existing.remark)
        if (!metadata || metadata.clientRequestId !== (data.clientRequestId || null) || JSON.stringify(metadata.request) !== JSON.stringify(request)) throw new ConflictException('该收货操作已用于其他内容，请刷新核对原收货记录，请勿重复入仓')
        return { receipt: this.serializeReceipt(existing), duplicate: true, poStatus: po.status }
      }
      if (!['finance_approved', 'at_logistics_wh', 'approved'].includes(po.status)) throw new BadRequestException('该采购单状态不可登记收货，请刷新核对')
      if (!warehouseCode) throw new BadRequestException('请指定物流中转仓')
      if (po.warehouseCode && warehouseCode !== po.warehouseCode) throw new BadRequestException('收货仓库与采购单目标中转仓不一致，请核对后再提交')
      const warehouse = await tx.warehouse.findUnique({ where: { warehouseCode } })
      if (!warehouse || warehouse.warehouseType !== 'logistics' || warehouse.status !== 1) throw new BadRequestException('请选择有效且启用的物流中转仓')
      const history = await tx.logisticsReceipt.findMany({ where: { poId: po.id }, include: { items: { orderBy: { id: 'asc' } } } })
      const progress = logisticsReceiptProgress(po.items, history)
      if (progress.issues.length) throw new BadRequestException(progress.issues.join('；'))
      const lines = request.items.map(line => {
        const poItem = po.items.find(item => Number(item.id) === line.poItemId)
        if (!poItem || (line.sku && line.sku !== poItem.sku)) throw new BadRequestException('收货明细与采购单商品不一致，请刷新核对')
        const pending = progress.items.find(item => item.id === poItem.id)!.pendingQty
        if (line.actualQty + line.damagedQty > pending) throw new BadRequestException(`${poItem.sku} 良品与破损合计超过待收数量 ${pending}`)
        return { ...line, poItem, pending }
      })
      // Product locks also serialize distinct POs sharing one product, including a missing stock row.
      const productIds = [...new Set(lines.map(line => line.poItem.productId))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
      for (const productId of productIds) {
        await tx.$queryRaw`SELECT id FROM product WHERE id = ${productId} FOR UPDATE`
        const product = await tx.product.findUnique({ where: { id: productId } })
        if (!product || lines.some(line => line.poItem.productId === productId && line.poItem.sku !== product.sku)) throw new BadRequestException('采购商品档案缺失或不一致，请先核对商品主数据')
        await tx.$queryRaw`SELECT id FROM inventory WHERE product_id = ${productId} AND warehouse_code = ${warehouseCode} FOR UPDATE`
      }
      const receipt = await tx.logisticsReceipt.create({
        data: { receiptNo, poId: po.id, poNo: po.poNo, warehouseCode, operatorName,
          remark: receiptStoredRemark(request, data.clientRequestId),
          items: { create: lines.map(line => ({ productId: line.poItem.productId, sku: line.poItem.sku,
            productName: line.poItem.productName, expectedQty: line.pending, actualQty: line.actualQty,
            damagedQty: line.damagedQty, qcStatus: line.qcStatus, qcRemark: line.qcRemark || undefined })) } },
        include: { items: { orderBy: { id: 'asc' } } },
      })
      // Normalize legacy goods-only counters from immutable receipt records in the same transaction.
      for (const item of progress.items) if (item.receivedQty !== po.items.find(line => line.id === item.id)!.receivedQty) await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQty: item.receivedQty } })
      for (const line of lines) {
        const item = line.poItem
        // Damaged pieces complete procurement receiving, but never enter usable inventory.
        await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQty: { increment: line.actualQty + line.damagedQty } } })
        if (line.actualQty <= 0) continue
        const inv = await tx.inventory.findUnique({ where: { productId_warehouseCode: { productId: item.productId, warehouseCode } } })
        const before = inv?.totalQty ?? 0
        if (before + line.actualQty > 2147483647 || (inv?.availableQty ?? 0) + line.actualQty > 2147483647) throw new BadRequestException('库存数量超出支持范围，请核对后再收货')
        if (inv) await tx.inventory.update({ where: { id: inv.id }, data: { totalQty: { increment: line.actualQty }, availableQty: { increment: line.actualQty } } })
        else await tx.inventory.create({ data: { productId: item.productId, sku: item.sku, warehouseCode, totalQty: line.actualQty, availableQty: line.actualQty } })
        await tx.inventoryLog.create({ data: { productId: item.productId, sku: item.sku, warehouseCode,
          changeType: 'logistics_receive', changeQty: line.actualQty, beforeQty: before, afterQty: before + line.actualQty,
          referenceNo: receiptNo, operatorId: operatorId ? BigInt(operatorId) : undefined, remark: `采购单 ${po.poNo}` } })
      }
      const updatedPo = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { items: true } })
      const allReceived = updatedPo.items.every(item => (item.receivedQty ?? 0) >= item.quantity)
      const poStatus = allReceived ? 'received' : 'at_logistics_wh'
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: poStatus, warehouseCode: po.warehouseCode || warehouseCode } })
      if (!po.warehouseCode && po.prePoId) await tx.prePurchaseOrder.update({ where: { id: po.prePoId }, data: { warehouseCode } })
      return { receipt: this.serializeReceipt(receipt), duplicate: false, poStatus }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
    if (!result.duplicate) await this.opLog.log({ operatorId, operatorName, module: 'logistics_receipt', action: 'create',
      targetType: 'logistics_receipt', targetId: result.receipt.receiptNo,
      detail: { poNo: result.receipt.poNo, warehouseCode: result.receipt.warehouseCode, itemCount: result.receipt.items.length } })
    return { ...result.receipt, duplicate: result.duplicate, poStatus: result.poStatus }
  }
}
