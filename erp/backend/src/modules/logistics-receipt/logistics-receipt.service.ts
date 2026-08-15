import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
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
    return {
      id: Number(row.id),
      receiptNo: row.receiptNo,
      poId: Number(row.poId),
      poNo: row.poNo,
      warehouseCode: row.warehouseCode,
      operatorName: row.operatorName || '',
      remark: row.remark || '',
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

    return pos
      .map((po) => {
        const pendingItems = po.items.filter((i) => (i.receivedQty ?? 0) < i.quantity)
        if (!pendingItems.length) return null
        return {
          id: Number(po.id),
          poNo: po.poNo,
          supplier: supMap.get(Number(po.supplierId)) || '—',
          warehouseCode: po.warehouseCode || '',
          skuCount: pendingItems.length,
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
              receivedQty: i.receivedQty ?? 0,
              pendingQty: i.quantity - (i.receivedQty ?? 0),
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

  async create(data: any, operatorName?: string, operatorId?: number) {
    const poId = Number(data.poId)
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id: BigInt(poId) }, include: { items: true } })
    if (!po) throw new NotFoundException('采购单不存在')
    if (!['finance_approved', 'at_logistics_wh', 'approved'].includes(po.status)) {
      throw new BadRequestException('该采购单状态不可登记收货')
    }

    const warehouseCode = data.warehouseCode || po.warehouseCode
    if (!warehouseCode) throw new BadRequestException('请指定物流仓库')
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { warehouseCode },
      select: { warehouseType: true },
    })
    if (!warehouse || warehouse.warehouseType !== 'logistics') {
      throw new BadRequestException('请选择有效的物流中转仓')
    }

    const lines: any[] = data.items || []
    if (!lines.length) throw new BadRequestException('请填写收货明细')

    const receiptNo = data.receiptNo || `LR-${Date.now().toString().slice(-8)}`

    return this.prisma.$transaction(async (tx) => {
      const receipt = await tx.logisticsReceipt.create({
        data: {
          receiptNo,
          poId: BigInt(poId),
          poNo: po.poNo,
          warehouseCode,
          operatorName: operatorName || data.operatorName,
          remark: data.remark,
          items: {
            create: lines.map((l) => {
              const poItem = po.items.find((i) => Number(i.id) === Number(l.poItemId) || i.sku === l.sku)
              if (!poItem) throw new BadRequestException(`SKU ${l.sku} 不在采购单中`)
              const actual = Number(l.actualQty ?? 0)
              const damaged = Number(l.damagedQty ?? 0)
              const pending = poItem.quantity - (poItem.receivedQty ?? 0)
              if (actual <= 0 && damaged <= 0) {
                throw new BadRequestException(`${l.sku} 请填写良品实收或破损数量`)
              }
              if (actual + damaged > pending) {
                throw new BadRequestException(`${l.sku} 良品 ${actual} + 破损 ${damaged} 超过待收 ${pending}`)
              }
              let qcStatus = l.qcStatus === 'fail' ? 'fail' : 'pass'
              if (damaged > 0 && !l.qcStatus) qcStatus = 'fail'
              return {
                productId: poItem.productId,
                sku: poItem.sku,
                productName: poItem.productName,
                expectedQty: pending,
                actualQty: actual,
                damagedQty: damaged,
                qcStatus,
                qcRemark: l.qcRemark?.trim() || undefined,
              }
            }),
          },
        },
        include: { items: true },
      })

      for (const item of receipt.items) {
        if (item.actualQty <= 0) continue
        const poItem = po.items.find((i) => i.sku === item.sku)!
        const newReceived = (poItem.receivedQty ?? 0) + item.actualQty
        await tx.purchaseOrderItem.update({
          where: { id: poItem.id },
          data: { receivedQty: newReceived },
        })

        const inv = await tx.inventory.findUnique({
          where: { productId_warehouseCode: { productId: item.productId, warehouseCode } },
        })
        const before = inv?.totalQty ?? 0
        const after = before + item.actualQty
        if (inv) {
          await tx.inventory.update({
            where: { id: inv.id },
            data: { totalQty: after, availableQty: inv.availableQty + item.actualQty },
          })
        } else {
          await tx.inventory.create({
            data: {
              productId: item.productId,
              sku: item.sku,
              warehouseCode,
              totalQty: after,
              availableQty: after,
            },
          })
        }
        await tx.inventoryLog.create({
          data: {
            productId: item.productId,
            sku: item.sku,
            warehouseCode,
            changeType: 'logistics_receive',
            changeQty: item.actualQty,
            beforeQty: before,
            afterQty: after,
            referenceNo: receiptNo,
            remark: `PO ${po.poNo}`,
          },
        })
      }

      const updatedPo = await tx.purchaseOrder.findUnique({ where: { id: BigInt(poId) }, include: { items: true } })
      const allReceived = updatedPo!.items.every((i) => (i.receivedQty ?? 0) >= i.quantity)
      await tx.purchaseOrder.update({
        where: { id: BigInt(poId) },
        data: {
          status: allReceived ? 'received' : 'at_logistics_wh',
          warehouseCode: po.warehouseCode || warehouseCode,
        },
      })
      if (!po.warehouseCode && po.prePoId) {
        await tx.prePurchaseOrder.update({
          where: { id: po.prePoId },
          data: { warehouseCode },
        })
      }

      return this.serializeReceipt(receipt)
    }).then(async (result) => {
      await this.opLog.log({
        operatorId,
        operatorName: operatorName || data.operatorName,
        module: 'logistics_receipt',
        action: 'create',
        targetType: 'logistics_receipt',
        targetId: result.receiptNo,
        detail: { poNo: po.poNo, warehouseCode, itemCount: result.items?.length },
      })
      return result
    })
  }
}
