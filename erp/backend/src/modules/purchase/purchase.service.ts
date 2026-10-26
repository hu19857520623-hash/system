import { assertGlobalSkuAvailable } from '../../common/global-sku.util'
import { randomUUID } from 'crypto'
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { AuthUser } from '../../common/decorators/current-user.decorator'
import { UpdatePurchasePackageDto } from './dto/purchase.dto'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { OperationLogService } from '../operation-log/operation-log.service'
import { allocatePoDomesticFreight } from '../../common/po-domestic-freight.util'
import { computePoFinanceApprovalCosts } from '../../common/po-finance-cost.util'
import { catalogSkuLookupKeys, toCatalogInternalSku } from '../../common/catalog-customer.util'
import { resolveProductPhysicalWeightKg } from '../../common/product-physical-weight.util'
import { logisticsReceiptProgress } from '../logistics-receipt/logistics-receipt-progress.util'
import { MAX_IMPORT_FAILURE_DETAILS, type ImportRowFailure, type ImportRowResult } from '../../common/import-row-result.util'
import {
  PURCHASE_IMPORT_MAX_ROWS,
  buildPurchaseImportPoNo,
  groupPurchaseImportLines,
  parsePurchaseImportCsv,
  resolveLogisticsWarehouseCode,
} from './purchase-import.util'

function fmtTime(d: Date | null | undefined): string {
  if (!d) return ''
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  deposit: '定金',
  balance: '尾款',
  full: '全款',
  other: '其他',
}

function decimalCents(value: unknown, label = '采购金额') {
  const numeric = Number(value)
  const text = Number.isFinite(numeric) ? numeric.toFixed(2) : ''
  if (!/^\d{1,12}\.\d{2}$/.test(text)) throw new BadRequestException(`${label}无效，请核对后再登记付款`)
  const [whole, fraction] = text.split('.')
  return Number(whole) * 100 + Number(fraction)
}

function moneyCents(value: unknown) {
  const text = typeof value === 'number' ? value.toFixed(2) : String(value ?? '').trim()
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(text)) throw new BadRequestException('付款金额须为大于 0、最多两位小数的金额')
  const [whole, fraction = ''] = text.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new BadRequestException('付款金额须为大于 0、最多两位小数的金额')
  return cents
}

function centsToMoney(cents: number) {
  return Number((cents / 100).toFixed(2))
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return ''
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

@Injectable()
export class PurchaseService {
  constructor(
    private prisma: PrismaService,
    private opLog: OperationLogService,
  ) {}

  private async enrichOrders(rows: any[]) {
    const receiving = rows.filter(row => ['finance_approved', 'at_logistics_wh', 'approved', 'received'].includes(row.status))
    if (receiving.length) {
      const receipts = await this.prisma.logisticsReceipt.findMany({ where: { poId: { in: receiving.map(row => row.id) } }, include: { items: { orderBy: { id: 'asc' } } } })
      rows = rows.map(row => {
        if (!receiving.includes(row)) return row
        const progress = logisticsReceiptProgress(row.items, receipts.filter(receipt => receipt.poId === row.id))
        return { ...row, items: progress.items, receiptIssue: progress.issues.join('；'),
          status: progress.issues.length ? row.status : progress.allReceived ? 'received' : progress.items.some(item => item.receivedQty > 0) ? 'at_logistics_wh' : row.status }
      })
    }
    if (!rows.length) return []
    const supplierIds = [...new Set(rows.map((r) => r.supplierId))]
    const userIds = [
      ...new Set(
        rows.flatMap((r) => [r.purchaserId, r.auditorId, r.financeId, r.paidBy].filter(Boolean)),
      ),
    ] as bigint[]
    const whCodes = [...new Set(rows.map((r) => r.warehouseCode).filter(Boolean))] as string[]
    const prePoIds = [...new Set(rows.map((r) => r.prePoId).filter(Boolean))] as bigint[]

    const [suppliers, users, warehouses, prePos] = await Promise.all([
      this.prisma.supplier.findMany({ where: { id: { in: supplierIds } } }),
      userIds.length ? this.prisma.sysUser.findMany({ where: { id: { in: userIds } } }) : [],
      whCodes.length ? this.prisma.warehouse.findMany({ where: { warehouseCode: { in: whCodes } } }) : [],
      prePoIds.length ? this.prisma.prePurchaseOrder.findMany({ where: { id: { in: prePoIds } }, select: { id: true, status: true } }) : [],
    ])
    const supMap = new Map<number, string>(suppliers.map((s) => [Number(s.id), s.supplierName] as [number, string]))
    const userMap = new Map<number, string>(users.map((u) => [Number(u.id), u.realName] as [number, string]))
    const whMap = new Map<string, string>(warehouses.map((w) => [w.warehouseCode, w.warehouseName] as [string, string]))
    const prePoStatusMap = new Map<number, string>(prePos.map((item) => [Number(item.id), item.status] as [number, string]))
    const paymentRows = rows.length
      ? await this.prisma.purchasePayment.findMany({ where: { poId: { in: rows.map((row) => row.id) } }, orderBy: { id: 'asc' } })
      : []
    const paymentsByPo = new Map<string, any[]>()
    for (const payment of paymentRows) {
      const key = String(payment.poId)
      paymentsByPo.set(key, [...(paymentsByPo.get(key) || []), payment])
    }

    return rows.map((row) => this.serialize(
      { ...row, payments: paymentsByPo.get(String(row.id)) || [] },
      supMap,
      userMap,
      whMap,
      prePoStatusMap.get(Number(row.prePoId)) || '',
    ))
  }

  private serialize(row: any, supMap: Map<number, string>, userMap: Map<number, string>, whMap: Map<string, string>, prePoStatus = '') {
    return {
      id: Number(row.id),
      prePoId: row.prePoId ? Number(row.prePoId) : null,
      prePoStatus,
      receiptIssue: row.receiptIssue || '',
      poNo: row.poNo,
      supplierId: Number(row.supplierId),
      supplierName: supMap.get(Number(row.supplierId)) || '—',
      warehouseCode: row.warehouseCode || '',
      warehouseName: whMap.get(row.warehouseCode || '') || row.warehouseCode || '—',
      totalAmount: Number(row.totalAmount),
      domesticFreight: row.domesticFreight != null ? Number(row.domesticFreight) : null,
      currency: row.currency || 'RMB',
      expectedArrival: row.expectedArrival,
      expectedArrivalStr: fmtDate(row.expectedArrival),
      remark: row.remark || '',
      status: row.status,
      purchaserId: row.purchaserId ? Number(row.purchaserId) : null,
      purchaserName: row.purchaserId ? userMap.get(Number(row.purchaserId)) || '—' : '—',
      auditorId: row.auditorId ? Number(row.auditorId) : null,
      auditorName: row.auditorId ? userMap.get(Number(row.auditorId)) || '—' : '—',
      auditedAt: row.auditedAt,
      auditedAtStr: fmtTime(row.auditedAt),
      poAuditRemark: row.poAuditRemark || '',
      financeId: row.financeId ? Number(row.financeId) : null,
      financeName: row.financeId ? userMap.get(Number(row.financeId)) || '—' : '—',
      financeAt: row.financeAt,
      financeAtStr: fmtTime(row.financeAt),
      financeRemark: row.financeRemark || '',
      ...this.paymentView(row),
      paidAt: row.paidAt,
      paidAtStr: fmtTime(row.paidAt),
      paidBy: row.paidBy ? Number(row.paidBy) : null,
      paidByName: row.paidBy ? userMap.get(Number(row.paidBy)) || '—' : '—',
      createdAt: row.createdAt,
      createdAtStr: fmtTime(row.createdAt),
      items: (row.items || []).map((i: any) => ({
        id: Number(i.id),
        productId: Number(i.productId),
        sku: i.sku,
        productName: i.productName || '',
        plannedQty: i.plannedQty ?? null,
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice),
        amount: Number(i.amount),
        domesticFreight: i.domesticFreight != null ? Number(i.domesticFreight) : null,
        receivedQty: i.receivedQty ?? 0,
        remark: i.remark || '',
      })),
    }
  }

  private serializePurchaseConfirmation(row: any) {
    if (!row) return null
    const number = (value: any) => value != null ? Number(value) : null
    return {
      prePoNo: row.prePoNo,
      updatedAt: row.updatedAt,
      applyNo: row.applyNo,
      spec: row.spec || '',
      supplierContactName: row.supplierContactName || '',
      supplierContactPhone: row.supplierContactPhone || '',
      supplierAddress: row.supplierAddress || '',
      productLink: row.productLink || '',
      accessories: row.accessories || '',
      productImageUrl: row.productImageUrl || '',
      manualUrl: row.manualUrl || '',
      moq: row.moq ?? null,
      leadTimeDays: row.leadTimeDays ?? null,
      unitPrice: number(row.unitPrice),
      domesticFreight: number(row.domesticFreight),
      taxRate: number(row.taxRate),
      invoiceTaxRate: number(row.invoiceTaxRate),
      unitTax: number(row.unitTax),
      unitFreight: number(row.unitFreight),
      productLengthCm: number(row.productLengthCm),
      productWidthCm: number(row.productWidthCm),
      productHeightCm: number(row.productHeightCm),
      productVolumeCbm: number(row.productVolumeCbm),
      packageWeightKg: number(row.packageWeightKg),
      packageLengthCm: number(row.packageLengthCm),
      packageWidthCm: number(row.packageWidthCm),
      packageHeightCm: number(row.packageHeightCm),
      packageVolumeCbm: number(row.packageVolumeCbm),
      volumetricWeightKg: number(row.volumetricWeightKg),
      sampleStatus: row.sampleStatus || '',
      samplePackageInfo: row.samplePackageInfo || '',
      sampleImageUrl: row.sampleImageUrl || '',
      doubleLayerCarton: row.doubleLayerCarton ?? null,
      notPurchaseReason: row.notPurchaseReason || '',
      logoUnitFee: number(row.logoUnitFee),
      logoTotalFee: number(row.logoTotalFee),
      cartonTotalPrice: number(row.cartonTotalPrice),
      spareCartonUnitPrice: number(row.spareCartonUnitPrice),
      spareCartonQty: row.spareCartonQty ?? null,
      piecesPerCarton: row.piecesPerCarton ?? null,
      remark: row.remark || '',
    }
  }

  /** 选品已通过、尚未分配采购员 */
  async listPendingSkuAssign(q: PaginationDto & { keyword?: string }) {
    const { page, pageSize } = getPagination(q)
    const keyword = q.keyword?.trim().toLowerCase()

    const devs = await this.prisma.productDev.findMany({
      where: { status: 'approved', purchaseQty: { gt: 0 } },
      orderBy: [{ auditedAt: 'desc' }, { id: 'desc' }],
    })

    const skus = devs.map((d) => d.sku?.trim()).filter(Boolean) as string[]
    const products = skus.length
      ? await this.prisma.product.findMany({ where: { sku: { in: skus } } })
      : []
    const productMap = new Map(products.map((p) => [p.sku, p]))

    const userIds = [...new Set(devs.map((d) => d.applicantId).filter(Boolean))] as bigint[]
    const users = userIds.length
      ? await this.prisma.sysUser.findMany({ where: { id: { in: userIds } }, select: { id: true, realName: true } })
      : []
    const userMap = new Map(users.map((u) => [Number(u.id), u.realName]))

    let all = devs
      .filter((dev) => {
        const sku = dev.sku?.trim()
        if (!sku) return true
        const product = productMap.get(sku)
        return !product?.purchaserId
      })
      .map((dev) => {
        const sku = dev.sku?.trim() || `TK-${String(dev.id).padStart(5, '0')}`
        return {
          devId: Number(dev.id),
          applyNo: dev.applyNo,
          sku,
          productName: dev.productName,
          spec: dev.spec || '',
          requiredQty: dev.purchaseQty || 0,
          unitPrice: dev.estimatedCost != null ? Number(dev.estimatedCost) : 0,
          marketPrice: dev.marketPrice != null ? Number(dev.marketPrice) : null,
          developerName: dev.applicantId ? userMap.get(Number(dev.applicantId)) || null : null,
          auditedAt: dev.auditedAt,
          auditedAtStr: fmtTime(dev.auditedAt),
          takealotUrl: dev.takealotUrl || '',
          auditRemark: dev.auditRemark || '',
        }
      })

    if (keyword) {
      all = all.filter(
        (r) =>
          r.applyNo.toLowerCase().includes(keyword)
          || r.productName.toLowerCase().includes(keyword)
          || r.sku.toLowerCase().includes(keyword),
      )
    }

    const total = all.length
    const items = all.slice((page - 1) * pageSize, page * pageSize)
    return { items, total, page, pageSize }
  }

  /** 将 SKU 采购需求分配给指定采购员 */
  async assignPurchaser(devId: number, purchaserId: number, operatorId?: number) {
    const row = await this.prisma.productDev.findUnique({ where: { id: BigInt(devId) } })
    if (!row) throw new NotFoundException('选品申请不存在')
    if (row.status !== 'approved') throw new BadRequestException('仅已通过选品可分配采购员')
    if (!purchaserId) throw new BadRequestException('请选择采购员')

    const purchaser = await this.prisma.sysUser.findUnique({ where: { id: BigInt(purchaserId) } })
    if (!purchaser || purchaser.roleCode !== 'purchaser') {
      throw new BadRequestException('请选择有效的采购员')
    }

    const sku = row.sku?.trim() || `TK-${String(devId).padStart(5, '0')}`

    return this.prisma.$transaction(async (tx) => {
      if (!row.sku?.trim()) {
        await tx.productDev.update({ where: { id: BigInt(devId) }, data: { sku } })
      }

      let product = await tx.product.findUnique({ where: { sku } })
      if (!product) {
        await assertGlobalSkuAvailable(tx, { sku })
        product = await tx.product.create({
          data: {
            sku,
            productName: row.productName,
            spec: row.spec ?? undefined,
            lengthCm: row.packageLengthCm ?? row.productLengthCm ?? undefined,
            widthCm: row.packageWidthCm ?? row.productWidthCm ?? undefined,
            heightCm: row.packageHeightCm ?? row.productHeightCm ?? undefined,
            // ProductDev only stores dimensional/volumetric weight. Keep the
            // physical weight empty until purchase confirmation or receiving.
            weightKg: undefined,
            costRmb: row.estimatedCost ?? undefined,
            takealotUrl: row.takealotUrl ?? undefined,
            imageUrl: row.takealotPriceImageUrl ?? row.alibaba1688ImageUrl ?? undefined,
            developerId: row.applicantId ?? undefined,
            status: 'pending',
            syncStatus: 'pending',
            remark: `选品申请 ${row.applyNo}`,
          },
        })
      }

      if (product.purchaserId) throw new BadRequestException('该 SKU 已分配采购员')

      await tx.product.update({
        where: { sku },
        data: { purchaserId: BigInt(purchaserId) },
      })

      return {
        devId,
        applyNo: row.applyNo,
        sku,
        productName: row.productName,
        purchaserId,
        purchaserName: purchaser.realName,
      }
    }).then(async (result) => {
      await this.opLog.log({
        operatorId,
        module: 'purchase',
        action: 'assign_purchaser',
        targetType: 'product_dev',
        targetId: row.applyNo,
        detail: { sku, purchaserId, purchaserName: purchaser.realName },
      })
      return result
    })
  }

  /** 已分配采购员、主数据待完善（status=pending） */
  async listPendingMasterData(q: PaginationDto & { keyword?: string }, viewer?: { userId: number; roleCode: string }) {
    const { page, pageSize } = getPagination(q)
    const keyword = q.keyword?.trim().toLowerCase()

    const where: any = { status: 'pending', purchaserId: { not: null } }
    if (viewer?.roleCode === 'purchaser') {
      where.purchaserId = BigInt(viewer.userId)
    }
    if (keyword) {
      where.OR = [
        { sku: { contains: keyword } },
        { productName: { contains: keyword } },
      ]
    }

    const [rows, totalAll] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { id: 'desc' },
      }),
      this.prisma.product.count({ where }),
    ])

    if (!rows.length) return { items: [], total: 0, page, pageSize }

    const skus = rows.map((p) => p.sku)
    const devs = await this.prisma.productDev.findMany({
      where: { sku: { in: skus }, status: 'approved' },
    })
    const devMap = new Map(devs.map((d) => [d.sku!, d]))

    const userIds = [
      ...new Set([
        ...rows.map((p) => p.developerId).filter(Boolean),
        ...rows.map((p) => p.purchaserId).filter(Boolean),
        ...rows.map((p) => p.supplierId).filter(Boolean),
      ]),
    ] as bigint[]
    const supplierIds = [...new Set(rows.map((p) => p.supplierId).filter(Boolean))] as bigint[]
    const [users, suppliers] = await Promise.all([
      userIds.length
        ? this.prisma.sysUser.findMany({ where: { id: { in: userIds } }, select: { id: true, realName: true } })
        : Promise.resolve([] as { id: bigint; realName: string }[]),
      supplierIds.length
        ? this.prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, supplierName: true } })
        : Promise.resolve([] as { id: bigint; supplierName: string }[]),
    ])
    const userMap = new Map<number, string>()
    users.forEach((u) => userMap.set(Number(u.id), u.realName))
    const supplierMap = new Map<number, string>()
    suppliers.forEach((s) => supplierMap.set(Number(s.id), s.supplierName))

    const all = rows.map((p) => {
      const dev = devMap.get(p.sku)
      return {
        productId: Number(p.id),
        devId: dev ? Number(dev.id) : null,
        applyNo: dev?.applyNo || '',
        sku: p.sku,
        productName: p.productName,
        spec: p.spec || '',
        costRmb: p.costRmb != null ? Number(p.costRmb) : null,
        lengthCm: p.lengthCm != null ? Number(p.lengthCm) : null,
        widthCm: p.widthCm != null ? Number(p.widthCm) : null,
        heightCm: p.heightCm != null ? Number(p.heightCm) : null,
        weightKg: p.weightKg != null ? Number(p.weightKg) : null,
        barcode: p.barcode || '',
        supplierId: p.supplierId ? Number(p.supplierId) : null,
        supplierName: p.supplierId ? supplierMap.get(Number(p.supplierId)) || null : null,
        developerName: p.developerId ? userMap.get(Number(p.developerId)) || null : null,
        purchaserId: p.purchaserId ? Number(p.purchaserId) : null,
        purchaserName: p.purchaserId ? userMap.get(Number(p.purchaserId)) || null : null,
        requiredQty: dev?.purchaseQty || 0,
        referenceCost: dev?.estimatedCost != null ? Number(dev.estimatedCost) : null,
        auditedAtStr: dev?.auditedAt ? fmtTime(dev.auditedAt) : '',
      }
    })

    const total = totalAll
    const items = all.slice((page - 1) * pageSize, page * pageSize)
    return { items, total, page, pageSize }
  }

  /** 选品审核通过、已分配采购员、尚未完全下单的采购需求 */
  async listPendingSkus(q: PaginationDto & { keyword?: string }, viewer?: { userId: number; roleCode: string }) {
    const { page, pageSize } = getPagination(q)
    const keyword = q.keyword?.trim()

    const devs = (await this.prisma.productDev.findMany({
      where: {
        status: 'approved',
        purchaseQty: { gt: 0 },
        ...(keyword
          ? {
              OR: [
                { sku: { contains: keyword } },
                { productName: { contains: keyword } },
                { applyNo: { contains: keyword } },
              ],
            }
          : {}),
      },
      orderBy: [{ auditedAt: 'desc' }, { id: 'desc' }],
    })).filter((d) => Boolean(d.sku?.trim()))

    if (!devs.length) return { items: [], total: 0, page, pageSize }

    const skus = devs.map((d) => d.sku!).filter(Boolean)
    const [poItems, products] = await Promise.all([
      this.prisma.purchaseOrderItem.findMany({
        where: { sku: { in: skus }, order: { status: { notIn: ['rejected', 'draft', 'voided'] } } },
        select: { sku: true, quantity: true },
      }),
      this.prisma.product.findMany({ where: { sku: { in: skus } } }),
    ])
    const userIds = [
      ...new Set([
        ...devs.map((d) => d.applicantId).filter(Boolean),
        ...products.map((p) => p.purchaserId).filter(Boolean),
      ]),
    ] as bigint[]
    const users = userIds.length
      ? await this.prisma.sysUser.findMany({ where: { id: { in: userIds } }, select: { id: true, realName: true } })
      : []

    const orderedMap = new Map<string, number>()
    poItems.forEach((item) => {
      orderedMap.set(item.sku, (orderedMap.get(item.sku) || 0) + item.quantity)
    })
    const productMap = new Map(products.map((p) => [p.sku, p]))
    const userMap = new Map(users.map((u) => [Number(u.id), u.realName]))

    const all = devs
      .map((dev) => {
        const sku = dev.sku!
        const requiredQty = dev.purchaseQty || 0
        const orderedQty = orderedMap.get(sku) || 0
        const pendingQty = Math.max(0, requiredQty - orderedQty)
        const product = productMap.get(sku)
        const unitPrice = product?.costRmb != null ? Number(product.costRmb) : dev.estimatedCost != null ? Number(dev.estimatedCost) : 0
        return {
          devId: Number(dev.id),
          applyNo: dev.applyNo,
          sku,
          productId: product ? Number(product.id) : null,
          productName: dev.productName,
          spec: dev.spec || '',
          requiredQty,
          orderedQty,
          pendingQty,
          unitPrice,
          marketPrice: dev.marketPrice != null ? Number(dev.marketPrice) : null,
          developerName: dev.applicantId ? userMap.get(Number(dev.applicantId)) || null : null,
          purchaserId: product?.purchaserId ? Number(product.purchaserId) : null,
          purchaserName: product?.purchaserId ? userMap.get(Number(product.purchaserId)) || null : null,
          auditedAt: dev.auditedAt,
          auditedAtStr: fmtTime(dev.auditedAt),
          takealotUrl: dev.takealotUrl || '',
          auditRemark: dev.auditRemark || '',
        }
      })
      .filter((row) => row.pendingQty > 0 && row.purchaserId && productMap.get(row.sku)?.status === 'active')
      .filter((row) => {
        if (viewer?.roleCode === 'purchaser') return row.purchaserId === viewer.userId
        return true
      })

    const total = all.length
    const items = all.slice((page - 1) * pageSize, page * pageSize)
    return { items, total, page, pageSize }
  }

  async list(q: PaginationDto & { status?: string }) {
    await this.promotePendingFinanceOrders()
    const { page, pageSize } = getPagination(q)
    const where: any = {}
    if (q.status) where.status = q.status
    if (q.keyword) where.poNo = { contains: q.keyword }
    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        include: { items: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'desc' },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ])
    const items = await this.enrichOrders(rows)
    return { items, total, page, pageSize }
  }

  async detail(id: number) {
    const row = await this.prisma.purchaseOrder.findUnique({
      where: { id: BigInt(id) },
      include: { items: true },
    })
    if (!row) throw new NotFoundException('采购单不存在')
    const [item] = await this.enrichOrders([row])
    const confirmation = row.prePoId
      ? await this.prisma.prePurchaseOrder.findUnique({ where: { id: row.prePoId } })
      : null
    return { ...item, purchaseConfirmation: this.serializePurchaseConfirmation(confirmation) }
  }

  /** Direct purchase orders also accept a manually entered supplier name. */
  private async resolveSupplierForCreate(data: any): Promise<bigint> {
    const supplierName = data.supplierName == null ? '' : String(data.supplierName).trim()
    if (supplierName) {
      const existing = await this.prisma.supplier.findFirst({ where: { supplierName }, orderBy: { id: 'asc' } })
      if (existing) return existing.id
      const supplierCode = `SUP-${Date.now()}-${Math.floor(Math.random() * 1000)}`.slice(0, 30)
      const created = await this.prisma.supplier.create({ data: { supplierCode, supplierName, paymentTerms: '现结' } })
      return created.id
    }
    if (data.supplierId) return BigInt(data.supplierId)
    throw new BadRequestException('请选择或填写供应商')
  }

  async create(data: any, purchaserId?: number) {
    const lines: any[] = data.items || data.lines || []
    if (!lines.length) throw new BadRequestException('请添加采购明细')

    const supplierId = await this.resolveSupplierForCreate(data)
    const warehouseCode = String(data.warehouseCode || '').trim()
    if (!warehouseCode) throw new BadRequestException('请选择目标中转仓')
    const prepared = lines.map((line) => {
      const quantity = Number(line.quantity ?? line.qty ?? 0)
      const unitPrice = Number(line.unitPrice ?? 0)
      const sku = String(line.sku ?? '').trim()
      const productName = String(line.productName ?? line.name ?? '').trim()
      if (!sku) throw new BadRequestException('SKU 不能为空')
      if (sku.length > 30) throw new BadRequestException('SKU 不能超过 30 字')
      if (!productName) throw new BadRequestException('请填写商品名称')
      if (!Number.isSafeInteger(quantity) || quantity < 1) throw new BadRequestException('采购数量须为大于零的整数')
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new BadRequestException('请填写大于零的采购单价')
      return { sku, productName, quantity, unitPrice, remark: line.remark ? String(line.remark) : undefined }
    })
    const orderDomestic = data.domesticFreight != null && data.domesticFreight !== '' ? Number(data.domesticFreight) : 0

    const created = await this.prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.findUnique({ where: { warehouseCode } })
      if (!warehouse || warehouse.status !== 1 || warehouse.warehouseType !== 'logistics') throw new BadRequestException('请选择有效且启用的物流中转仓')
      return this.createAssignmentPreOrders(tx, {
        supplierId,
        warehouseCode,
        expectedArrival: data.expectedArrival,
        remark: data.remark,
        domesticFreight: orderDomestic > 0 ? orderDomestic : undefined,
        lines: prepared,
        reason: '创建采购单后进入分配',
      })
    })
    await this.opLog.log({
      operatorId: purchaserId,
      module: 'purchase',
      action: 'create',
      targetType: 'pre_purchase_order',
      targetId: created[0]?.prePoNo,
      detail: { count: created.length, prePoNos: created.map((row) => row.prePoNo), warehouseCode },
    })
    return {
      status: 'pending_assign',
      count: created.length,
      prePurchaseOrders: created.map((row) => ({
        id: Number(row.id),
        prePoNo: row.prePoNo,
        sku: row.sku,
        status: row.status,
      })),
    }
  }

  /** 直接创建或尚未关联预采购的审核通过：按明细生成待分配预采购，不进入打款。 */
  private async createAssignmentPreOrders(db: any, input: {
    supplierId: bigint
    warehouseCode?: string | null
    expectedArrival?: Date | string | null
    remark?: string | null
    domesticFreight?: number | null
    lines: { sku: string; productName: string; quantity: number; unitPrice: number; remark?: string }[]
    convertedPoId?: bigint
    reason: string
  }) {
    const totalQty = input.lines.reduce((sum, line) => sum + line.quantity, 0)
    const orderFreight = input.domesticFreight != null ? Number(input.domesticFreight) : 0
    const created: any[] = []
    for (let index = 0; index < input.lines.length; index++) {
      const line = input.lines[index]
      if (!line.sku) throw new BadRequestException('SKU 不能为空')
      if (!line.productName) throw new BadRequestException('请填写商品名称')
      let dev = await db.productDev.findFirst({ where: { sku: line.sku } })
      if (!dev) {
        const stamp = `${Date.now().toString(36)}${randomUUID().replace(/-/g, '').slice(0, 6)}`.toUpperCase()
        dev = await db.productDev.create({
          data: {
            applyNo: `PD-${stamp}${index}`.slice(0, 30),
            sku: line.sku,
            productName: line.productName,
            status: 'approved',
            purchaseQty: line.quantity,
            estimatedCost: line.unitPrice,
            reason: input.reason,
          },
        })
      }
      const lineFreight = orderFreight > 0 && totalQty > 0
        ? Math.round((orderFreight * line.quantity) / totalQty * 100) / 100
        : undefined
      const stamp = `${Date.now().toString(36)}${randomUUID().replace(/-/g, '').slice(0, 6)}`.toUpperCase()
      created.push(await db.prePurchaseOrder.create({
        data: {
          prePoNo: `PRE-${stamp}${index}`.slice(0, 30),
          devId: dev.id,
          applyNo: dev.applyNo,
          sku: line.sku,
          productName: line.productName,
          plannedQty: line.quantity,
          unitPrice: line.unitPrice,
          supplierId: input.supplierId,
          warehouseCode: input.warehouseCode || null,
          domesticFreight: lineFreight,
          expectedArrival: input.expectedArrival ? new Date(input.expectedArrival) : undefined,
          remark: line.remark || input.remark || undefined,
          status: 'pending_assign',
          convertedPoId: input.lines.length === 1 ? input.convertedPoId : undefined,
        },
      }))
    }
    return created
  }

  /** 按创建采购单的字段批量导入。每条明细生成一张待分配预采购单；相同抬头的行分摊同一笔国内运费。 */
  async importFromCsv(content: string, purchaserId?: number): Promise<ImportRowResult> {
    let parsed: ReturnType<typeof parsePurchaseImportCsv>
    try {
      parsed = parsePurchaseImportCsv(content)
    } catch (error: any) {
      throw new BadRequestException(error?.message || '导入文件格式错误')
    }
    const totalRows = parsed.lines.length + parsed.failureCount
    if (!totalRows) throw new BadRequestException('文件为空或没有有效数据行')
    if (totalRows > PURCHASE_IMPORT_MAX_ROWS) {
      throw new BadRequestException(`单次最多导入 ${PURCHASE_IMPORT_MAX_ROWS} 行`)
    }

    const warehouses = await this.prisma.warehouse.findMany({
      where: { warehouseType: 'logistics', status: 1 },
      select: { warehouseCode: true, warehouseName: true },
    })
    const skus = [...new Set(parsed.lines.map((line) => line.sku))]
    const products = skus.length
      ? await this.prisma.product.findMany({
        where: { sku: { in: skus } },
        select: { id: true, sku: true, productName: true },
      })
      : []
    const productBySku = new Map(products.map((product) => [product.sku.toLowerCase(), product]))

    let ok = 0
    let fail = parsed.failureCount
    const failures: ImportRowFailure[] = [...parsed.failures]
    const recordFail = (lineNo: number, reason: string, sku?: string) => {
      fail++
      if (failures.length < MAX_IMPORT_FAILURE_DETAILS) {
        failures.push({ lineNo, reason, ...(sku ? { sku } : {}) })
      }
    }

    let orderSeq = 0
    for (const group of groupPurchaseImportLines(parsed.lines)) {
      const warehouse = resolveLogisticsWarehouseCode(group.warehouseKey, warehouses)
      if (!warehouse.code) {
        const reason = warehouse.ambiguous
          ? `目标中转仓「${group.warehouseKey}」对应多个仓库，请改填仓库代码`
          : `目标中转仓「${group.warehouseKey}」不是已启用的物流中转仓`
        for (const line of group.lines) recordFail(line.lineNo, reason, line.sku)
        continue
      }
      orderSeq++
      try {
        await this.create({
          poNo: buildPurchaseImportPoNo(orderSeq),
          supplierName: group.supplierName,
          warehouseCode: warehouse.code,
          expectedArrival: group.expectedArrival,
          domesticFreight: group.domesticFreight,
          remark: group.orderRemark,
          items: group.lines.map((line) => {
            const product = productBySku.get(line.sku.toLowerCase())
            return {
              productId: product ? Number(product.id) : 0,
              sku: product?.sku || line.sku,
              productName: line.productName || product?.productName || undefined,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              remark: line.lineRemark,
            }
          }),
        }, purchaserId)
        ok += group.lines.length
      } catch (error: any) {
        const reason = error?.message || '写入失败'
        for (const line of group.lines) recordFail(line.lineNo, reason, line.sku)
      }
    }

    return { imported: ok, failed: fail, failures }
  }

  async approve(id: number, auditorId?: number, remark?: string, warehouseCode?: string) {
    const auditWarehouseCode = String(warehouseCode || '').trim()
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM purchase_order WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.purchaseOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true } })
      if (!row) throw new NotFoundException('采购单不存在')
      if (row.status !== 'pending_po_audit') throw new BadRequestException('采购单状态已变化，请刷新核对后再审核')
      const targetWarehouseCode = row.warehouseCode || auditWarehouseCode
      if (!targetWarehouseCode) throw new BadRequestException('请先补充目标中转仓后再审核通过')
      const warehouse = await tx.warehouse.findUnique({ where: { warehouseCode: targetWarehouseCode } })
      if (!warehouse || warehouse.status !== 1 || warehouse.warehouseType !== 'logistics') throw new BadRequestException('请选择有效且启用的物流中转仓')
      if (!row.items.length || row.items.some(line => !Number.isSafeInteger(line.quantity) || line.quantity <= 0 || !Number.isFinite(Number(line.unitPrice)) || Number(line.unitPrice) <= 0)) throw new BadRequestException('请先核对采购明细，每项数量须为正整数、采购单价须大于零')
      if (!row.prePoId) {
        if (!row.supplierId) throw new BadRequestException('请先补充供应商后再转入分配')
        const pres = await this.createAssignmentPreOrders(tx, {
          supplierId: row.supplierId,
          warehouseCode: targetWarehouseCode,
          expectedArrival: row.expectedArrival,
          remark: row.remark,
          domesticFreight: row.domesticFreight != null ? Number(row.domesticFreight) : undefined,
          lines: row.items.map((line) => ({
            sku: String(line.sku || '').trim(),
            productName: String(line.productName || line.sku || '').trim(),
            quantity: line.quantity,
            unitPrice: Number(line.unitPrice),
          })),
          convertedPoId: row.items.length === 1 ? row.id : undefined,
          reason: `采购审核通过后转入分配 ${row.poNo}`,
        })
        return tx.purchaseOrder.update({
          where: { id: BigInt(id) },
          data: {
            status: 'draft',
            prePoId: row.items.length === 1 ? pres[0].id : undefined,
            warehouseCode: row.warehouseCode ? undefined : targetWarehouseCode,
            auditorId: auditorId ? BigInt(auditorId) : undefined,
            auditedAt: new Date(),
            poAuditRemark: remark || '审核通过，转入预采购分配',
          } as any,
          include: { items: true },
        })
      }
      const order = await tx.purchaseOrder.update({
        where: { id: BigInt(id) },
        data: {
          status: 'finance_approved',
          paymentStatus: 'unpaid',
          warehouseCode: row.warehouseCode ? undefined : targetWarehouseCode,
          auditorId: auditorId ? BigInt(auditorId) : undefined,
          auditedAt: new Date(),
          poAuditRemark: remark || '审核通过',
        } as any,
        include: { items: true },
      })
      if (!row.warehouseCode && row.prePoId) {
        await tx.prePurchaseOrder.update({
          where: { id: row.prePoId },
          data: { warehouseCode: targetWarehouseCode },
        })
      }
      await this.applyPostAuditEffects(tx, order, auditorId)
      return order
    })
    const [item] = await this.enrichOrders([updated])
    await this.opLog.log({
      operatorId: auditorId,
      module: 'purchase',
      action: 'po_approve',
      targetType: 'purchase_order',
      targetId: item.poNo,
      detail: { remark: remark || '审核通过', warehouseCode: updated.warehouseCode, statusAfter: item.status },
    })
    return item
  }

  async rejectPoAudit(id: number, auditorId?: number, remark?: string) {
    if (!remark?.trim()) throw new BadRequestException('请填写驳回原因')
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM purchase_order WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.purchaseOrder.findUnique({ where: { id: BigInt(id) } })
      if (!row) throw new NotFoundException('采购单不存在')
      if (row.status !== 'pending_po_audit') throw new BadRequestException('采购单状态已变化，请刷新核对后再驳回')
      if (row.prePoId) {
        const prePo = await tx.prePurchaseOrder.findUnique({ where: { id: row.prePoId } })
        if (!prePo || prePo.convertedPoId !== row.id || prePo.status !== 'confirmed') throw new BadRequestException('关联预采购单状态异常，请联系管理员核对')
        await tx.prePurchaseOrder.update({ where: { id: prePo.id }, data: { status: 'returned' } })
      }
      return tx.purchaseOrder.update({
        where: { id: BigInt(id) },
        data: {
          status: 'rejected',
          auditorId: auditorId ? BigInt(auditorId) : undefined,
          auditedAt: new Date(),
          poAuditRemark: remark.trim(),
        } as any,
        include: { items: true },
      })
    })
    const [item] = await this.enrichOrders([updated])
    await this.opLog.log({
      operatorId: auditorId,
      module: 'purchase',
      action: 'po_reject',
      targetType: 'purchase_order',
      targetId: item.poNo,
      detail: { remark: remark?.trim() },
    })
    return item
  }

  /** 产品主管核定实际采购数量 → 进入采购主管审核 */
  async setActualQty(id: number, body: { quantity?: number; remark?: string }, operatorId?: number) {
    const qty = Number(body.quantity)
    if (!Number.isSafeInteger(qty) || qty <= 0 || qty > 2147483647) throw new BadRequestException('实际采购数量须为 1 至 2147483647 的整数')
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM purchase_order WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.purchaseOrder.findUnique({
        where: { id: BigInt(id) },
        include: { items: true },
      })
      if (!row) throw new NotFoundException('采购单不存在')
      if (row.status !== 'pending_actual_qty') throw new BadRequestException('当前状态不可核定实际采购数量')

      const line = row.items[0]
      if (!line) throw new BadRequestException('采购明细为空')
      if (row.items.length !== 1) throw new BadRequestException('该单包含多项采购明细，请联系管理员逐项核对数量')

      const unitPrice = Number(line.unitPrice)
      const amount = Math.round(qty * unitPrice * 100) / 100
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new BadRequestException('请先补充有效的采购单价')
      if (!Number.isFinite(amount) || amount > 999999999999.99) throw new BadRequestException('采购金额超出支持范围，请核对数量和单价')
      const orderDomestic = row.domesticFreight != null ? Number(row.domesticFreight) : 0
      let lineDomestic = line.domesticFreight != null ? Number(line.domesticFreight) : undefined
      if (lineDomestic == null && orderDomestic > 0) {
        lineDomestic = orderDomestic
      }

      return tx.purchaseOrder.update({
        where: { id: BigInt(id) },
        data: {
          status: 'pending_po_audit',
          totalAmount: amount,
          items: {
            update: {
              where: { id: line.id },
              data: {
                quantity: qty,
                amount,
                domesticFreight: lineDomestic,
                remark: body.remark?.trim() || line.remark,
              },
            },
          },
        },
        include: { items: true },
      })
    })

    const [item] = await this.enrichOrders([updated])
    await this.opLog.log({
      operatorId,
      module: 'purchase',
      action: 'set_actual_qty',
      targetType: 'purchase_order',
      targetId: item.poNo,
      detail: { sku: updated.items[0].sku, plannedQty: updated.items[0].plannedQty, actualQty: qty },
    })
    return item
  }

  private async syncProductMasterFromLine(tx: any, po: any, line: any, domesticFeePerUnit = 0) {
    const prePo = po.prePoId
      ? await tx.prePurchaseOrder.findUnique({ where: { id: po.prePoId } })
      : null
    const dev = await tx.productDev.findFirst({
      where: prePo
        ? { id: prePo.devId }
        : { sku: line.sku, status: 'approved' },
      orderBy: { id: 'desc' },
    })
    const productData = {
      productName: line.productName || prePo?.productName || dev?.productName || line.sku,
      spec: prePo?.spec ?? dev?.spec ?? undefined,
      lengthCm: prePo?.packageLengthCm ?? dev?.packageLengthCm ?? dev?.productLengthCm ?? undefined,
      widthCm: prePo?.packageWidthCm ?? dev?.packageWidthCm ?? dev?.productWidthCm ?? undefined,
      heightCm: prePo?.packageHeightCm ?? dev?.packageHeightCm ?? dev?.productHeightCm ?? undefined,
      weightKg: resolveProductPhysicalWeightKg(prePo, dev),
      costRmb: line.unitPrice,
      domesticFeePerUnit: domesticFeePerUnit > 0 ? domesticFeePerUnit : undefined,
      takealotUrl: prePo?.productLink ?? dev?.takealotUrl ?? undefined,
      imageUrl: prePo?.productImageUrl ?? dev?.takealotPriceImageUrl ?? dev?.alibaba1688ImageUrl ?? undefined,
      developerId: dev?.applicantId ?? undefined,
      purchaserId: po.purchaserId ?? undefined,
      supplierId: po.supplierId,
      status: 'active',
      syncStatus: 'pending',
      remark: dev ? `选品申请 ${dev.applyNo}` : undefined,
    }

    let product = await tx.product.findUnique({ where: { sku: line.sku } })
    if (product) {
      product = await tx.product.update({ where: { sku: line.sku }, data: productData })
    } else {
      await assertGlobalSkuAvailable(tx, { sku: line.sku })
      product = await tx.product.create({ data: { sku: line.sku, ...productData } })
    }

    await tx.purchaseOrderItem.update({
      where: { id: line.id },
      data: { productId: product.id },
    })
    return product
  }

  /** 财务审核通过时，将采购单费用拆分写入成本台账；成本编号固定，重复执行不会重复记账。 */
  private async createCostLedgersForFinanceApproval(
    tx: any,
    po: any,
    productLines: Array<{ line: any; product: any }>,
    financeId?: number,
    costBreakdown?: ReturnType<typeof computePoFinanceApprovalCosts>,
  ) {
    const confirmation = po.prePoId
      ? await tx.prePurchaseOrder.findUnique({ where: { id: po.prePoId } })
      : null
    const breakdown = costBreakdown ?? computePoFinanceApprovalCosts(
      { ...po, items: po.items },
      confirmation,
    )
    const costDate = po.financeAt || new Date()
    const rows: any[] = []

    for (const entry of productLines) {
      const { line } = entry
      const prefix = `C${po.id.toString(36)}-${line.id.toString(36)}`
      const lineEntries = breakdown.entries.filter((e) => e.sku === line.sku)
      for (const e of lineEntries) {
        if (e.amountRmb <= 0) continue
        const suffix = e.costType === '采购货款' ? 'P' : e.costType === '国内运费' ? 'F' : e.costType === '采购税费' ? 'T' : 'X'
        rows.push({
          costNo: `${prefix}${suffix}`,
          productId: entry.product?.id || (line.productId && line.productId !== BigInt(0) ? line.productId : undefined),
          sku: line.sku,
          costType: e.costType,
          amountRmb: e.amountRmb,
          referenceNo: po.poNo,
          costDate,
          remark: e.remark,
          createdBy: financeId ? BigInt(financeId) : undefined,
        })
      }
    }

    const orderPrefix = `C${po.id.toString(36)}`
    const orderEntries = breakdown.entries.filter((e) => !e.sku)
    const orderSuffix: Record<string, string> = { Logo费用: 'L', 纸箱费用: 'C', 备用纸箱: 'S' }
    const firstLine = productLines[0]
    for (const e of orderEntries) {
      if (e.amountRmb <= 0) continue
      rows.push({
        costNo: `${orderPrefix}${orderSuffix[e.costType] || 'X'}`,
        productId: firstLine?.product?.id,
        sku: firstLine?.line?.sku,
        costType: e.costType,
        amountRmb: e.amountRmb,
        referenceNo: po.poNo,
        costDate,
        remark: e.remark,
        createdBy: financeId ? BigInt(financeId) : undefined,
      })
    }

    if (rows.length) await tx.costLedger.createMany({ data: rows, skipDuplicates: true })
    return { count: rows.length, breakdown }
  }

  /** 采购审核通过后写入成本台账；打款标记时幂等补齐，与是否已打款无关。 */
  private async ensureCostRecordsForPo(tx: any, po: any, operatorId?: number) {
    const confirmation = po.prePoId
      ? await tx.prePurchaseOrder.findUnique({ where: { id: po.prePoId } })
      : null
    const costBreakdown = computePoFinanceApprovalCosts(po, confirmation)
    const productLines: Array<{ line: any; product: any }> = []
    for (const line of po.items || []) {
      let product = null
      if (line.productId && line.productId !== BigInt(0)) {
        product = await tx.product.findUnique({ where: { id: line.productId } })
      }
      productLines.push({ line, product })
    }
    await this.createCostLedgersForFinanceApproval(tx, po, productLines, operatorId, costBreakdown)
    return costBreakdown
  }

  /** 补齐历史财务已通过但尚未写入成本台账的采购单。 */
  async backfillFinanceApprovedCostLedgers() {
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { status: 'finance_approved' },
      include: { items: true },
    })
    let processed = 0
    for (const order of orders) {
      await this.prisma.$transaction(async (tx) => {
        const productLines = order.items.map((line) => ({ line, product: line.productId && line.productId !== BigInt(0) ? { id: line.productId } : null }))
        const confirmation = order.prePoId
          ? await tx.prePurchaseOrder.findUnique({ where: { id: order.prePoId } })
          : null
        const costBreakdown = computePoFinanceApprovalCosts(order, confirmation)
        await this.createCostLedgersForFinanceApproval(tx, order, productLines, undefined, costBreakdown)
      })
      processed += 1
    }
    return { processed }
  }

  /** 采购审核通过后同步商品主数据、成本台账与供应商账单。 */
  private async applyPostAuditEffects(tx: any, po: any, operatorId?: number) {
    const { perLine: lineDomesticMap } = allocatePoDomesticFreight(po)
    const productLines: Array<{ line: any; product: any }> = []

    for (const line of po.items) {
      const qty = line.quantity
      const unitPrice = Number(line.unitPrice)
      const lineDomestic = lineDomesticMap.get(String(line.id)) ?? 0
      const domesticPerUnit = qty > 0 ? lineDomestic / qty : 0
      const product = await this.syncProductMasterFromLine(tx, po, line, domesticPerUnit)
      productLines.push({ line, product })

      const catalogSku = toCatalogInternalSku(line.sku)
      const existing = await tx.productPricing.findFirst({
        where: { sku: { in: catalogSkuLookupKeys(line.sku) } },
      })
      const samePo = existing?.poNo === po.poNo
      const pricingData = {
        productName: line.productName || line.sku,
        costRmb: unitPrice,
        purchaseQty: existing
          ? (samePo ? qty : (existing.purchaseQty ?? 0) + qty)
          : qty,
        poNo: po.poNo,
        domesticFee: domesticPerUnit,
      }
      if (existing) {
        await tx.productPricing.update({ where: { sku: existing.sku }, data: pricingData })
      } else {
        await tx.productPricing.create({
          data: {
            sku: catalogSku,
            ...pricingData,
            pricingStatus: 'waiting_freight',
            exchangeRate: 2.5,
          },
        })
      }
    }

    await this.ensureCostRecordsForPo(tx, po, operatorId)

    for (const { line } of productLines) {
      await this.opLog.log({
        operatorId,
        module: 'product',
        action: 'sync_from_po',
        targetType: 'product',
        targetId: line.sku,
        detail: {
          message: `采购审核通过，采购单 ${po.poNo} 同步主数据：采购成本 ¥${Number(line.unitPrice)}/件`,
          poNo: po.poNo,
          costRmb: Number(line.unitPrice),
        },
      })
    }
  }

  /** 将历史「待财务审核」单据推进到已审核，并补齐主数据/成本。 */
  private async promotePendingFinanceOrders() {
    const pending = await this.prisma.purchaseOrder.findMany({
      where: { status: 'pending_finance' },
      include: { items: true },
    })
    for (const row of pending) {
      await this.prisma.$transaction(async (tx) => {
        const order = await tx.purchaseOrder.update({
          where: { id: row.id },
          data: {
            status: 'finance_approved',
            paymentStatus: 'unpaid',
            financeRemark: row.financeRemark || '财务审核环节已取消，采购审核通过后直接待收货',
          } as any,
          include: { items: true },
        })
        await this.applyPostAuditEffects(tx, order, row.auditorId ? Number(row.auditorId) : undefined)
      })
    }
  }

  private paymentView(row: any) {
    const payments = (row.payments || []).map((payment: any) => ({
      id: Number(payment.id),
      paymentType: payment.paymentType,
      paymentTypeLabel: PAYMENT_TYPE_LABELS[payment.paymentType] || payment.paymentType,
      amount: Number(payment.amount),
      remark: payment.remark || '',
      paidAtStr: fmtTime(payment.paidAt),
      paidByName: payment.paidByName || '',
    }))
    const totalCents = Number.isFinite(Number(row.totalAmount)) ? decimalCents(row.totalAmount) : 0
    const paidCents = (row.payments || []).reduce((sum: number, payment: any) => sum + decimalCents(payment.amount), 0)
    const unpaidCents = Math.max(totalCents - paidCents, 0)
    const legacyPaid = row.paymentStatus === 'paid' && payments.length === 0
    const paymentStatus = legacyPaid ? 'paid' : paidCents <= 0 ? 'unpaid' : unpaidCents <= 0 ? 'paid' : 'partial'
    const paidAmount = centsToMoney(paidCents)
    const paymentStatusLabel = paymentStatus === 'unpaid'
      ? '未打款'
      : paymentStatus === 'paid'
        ? (legacyPaid ? '已打款' : `已付清 ¥${paidAmount.toFixed(2)}`)
        : `${payments[payments.length - 1]?.paymentTypeLabel || '部分付款'} ¥${paidAmount.toFixed(2)}`
    return {
      paymentStatus,
      paymentStatusLabel,
      paidAmount,
      unpaidAmount: legacyPaid ? 0 : centsToMoney(unpaidCents),
      payments,
    }
  }

  async setPaymentStatus(
    id: number,
    paid: boolean,
    operatorId?: number,
    remark?: string,
    payment?: { paymentType?: string; amount?: number },
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM purchase_order WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.purchaseOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true } })
      if (!row) throw new NotFoundException('采购单不存在')
      const markable = ['finance_approved', 'at_logistics_wh', 'received', 'completed', 'approved']
      if (!markable.includes(row.status)) throw new BadRequestException('采购审核通过后才能标记打款状态')
      const existing = await tx.purchasePayment.findMany({ where: { poId: row.id }, orderBy: { id: 'asc' } })
      if (!paid) {
        if ((row.paymentStatus || 'unpaid') === 'unpaid' && existing.length === 0) throw new BadRequestException('该采购单已是未打款')
        await tx.purchasePayment.deleteMany({ where: { poId: row.id } })
        const order = await tx.purchaseOrder.update({
          where: { id: BigInt(id) },
          data: {
            paymentStatus: 'unpaid',
            paidAt: null,
            paidBy: null,
            financeRemark: remark?.trim() || '已标记未打款',
          } as any,
          include: { items: true },
        })
        await this.ensureCostRecordsForPo(tx, order, operatorId)
        return order
      }
      const totalCents = decimalCents(row.totalAmount)
      const paidCents = existing.reduce((sum, item) => sum + decimalCents(item.amount), 0)
      const paymentType = String(payment?.paymentType || '')
      const typeLabel = PAYMENT_TYPE_LABELS[paymentType]
      if (!typeLabel) throw new BadRequestException('请选择定金、尾款、全款或其他')
      if ((row.paymentStatus || 'unpaid') === 'paid' && paidCents === 0) throw new BadRequestException('该采购单已标记付清但没有付款明细，请先清除打款后再按金额登记')
      const remaining = totalCents - paidCents
      if (remaining <= 0) throw new BadRequestException('该采购单已付清')
      const amountCents = moneyCents(payment?.amount)
      if (amountCents > remaining) throw new BadRequestException(`付款金额不能超过待付 ¥${centsToMoney(remaining).toFixed(2)}`)
      if (paymentType === 'full' && amountCents !== remaining) throw new BadRequestException(`全款须等于待付金额 ¥${centsToMoney(remaining).toFixed(2)}`)
      if (paymentType === 'deposit' && amountCents >= totalCents) throw new BadRequestException('定金须小于采购总额，付清请选择全款')
      if (paymentType === 'balance' && existing.length === 0) throw new BadRequestException('尚未登记定金或其他付款，不能标记尾款')
      const amount = centsToMoney(amountCents)
      const note = remark?.trim() || ''
      await tx.purchasePayment.create({
        data: {
          poId: row.id,
          paymentType,
          amount: amount.toFixed(2),
          remark: note || null,
          paidBy: operatorId ? BigInt(operatorId) : null,
        },
      })
      const nextStatus = paidCents + amountCents >= totalCents ? 'paid' : 'partial'
      const order = await tx.purchaseOrder.update({
        where: { id: BigInt(id) },
        data: {
          paymentStatus: nextStatus,
          paidAt: new Date(),
          paidBy: operatorId ? BigInt(operatorId) : null,
          financeRemark: note ? `${typeLabel} ¥${amount.toFixed(2)}，${note}` : `${typeLabel} ¥${amount.toFixed(2)}`,
        } as any,
        include: { items: true },
      })
      await this.ensureCostRecordsForPo(tx, order, operatorId)
      return order
    })
    const [item] = await this.enrichOrders([updated])
    await this.opLog.log({
      operatorId,
      module: 'purchase',
      action: paid ? 'po_mark_paid' : 'po_mark_unpaid',
      targetType: 'purchase_order',
      targetId: item.poNo,
      detail: {
        paymentStatus: item.paymentStatus,
        paymentType: payment?.paymentType || null,
        amount: payment?.amount ?? null,
        remark: remark?.trim() || (paid ? '登记付款' : '已标记未打款'),
        totalAmount: item.totalAmount,
        supplierName: item.supplierName,
      },
    })
    return item
  }

  async financeApprove(id: number, financeId?: number, remark?: string) {
    const row = await this.detail(id)
    if (row.status !== 'pending_finance') throw new BadRequestException('财务审核环节已取消，请在采购审核通过后标记打款')

    const updated = await this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.update({
        where: { id: BigInt(id) },
        data: {
          status: 'finance_approved',
          paymentStatus: 'unpaid',
          financeId: financeId ? BigInt(financeId) : undefined,
          financeAt: new Date(),
          financeRemark: remark || '财务审核环节已取消',
        } as any,
        include: { items: true },
      })
      await this.applyPostAuditEffects(tx, po, financeId)
      return po
    })
    const [item] = await this.enrichOrders([updated])
    return item
  }

  async rejectFinance(id: number, financeId?: number, remark?: string) {
    const row = await this.detail(id)
    if (row.status !== 'pending_finance') throw new BadRequestException('当前状态不可驳回')
    if (!remark?.trim()) throw new BadRequestException('请填写驳回原因')
    const updated = await this.prisma.purchaseOrder.update({
      where: { id: BigInt(id) },
      data: {
        status: 'rejected',
        financeId: financeId ? BigInt(financeId) : undefined,
        financeAt: new Date(),
        financeRemark: remark.trim(),
      } as any,
      include: { items: true },
    })
    const [item] = await this.enrichOrders([updated])
    await this.opLog.log({
      operatorId: financeId,
      module: 'purchase',
      action: 'finance_reject',
      targetType: 'purchase_order',
      targetId: item.poNo,
      detail: { remark: remark?.trim() },
    })
    return item
  }

  /** 审核通过且尚未收货、付款的采购单退回待审核，并清掉本次审核写入的成本，改完后重新审核。 */
  async reopenAudit(id: number, operatorId?: number, remark?: string) {
    const reason = String(remark || '').trim() || '撤回审核，退回待审核'
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM purchase_order WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.purchaseOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true } })
      if (!row) throw new NotFoundException('采购单不存在')
      if (!['finance_approved', 'approved'].includes(row.status)) throw new BadRequestException('仅审核通过且尚未收货的采购单可以撤回到待审核')
      if (row.items.some((line) => (line.receivedQty ?? 0) > 0)) throw new BadRequestException('该采购单已有收货数量，不能撤回审核')
      const [receipts, inbounds, bills, payments] = await Promise.all([
        tx.logisticsReceipt.count({ where: { poId: row.id } }),
        tx.inboundOrder.count({ where: { poId: row.id } }),
        tx.supplierFreightBill.count({ where: { poId: row.id } }),
        tx.purchasePayment.count({ where: { poId: row.id } }),
      ])
      if (receipts || inbounds) throw new BadRequestException('该采购单已有收货或入库记录，不能撤回审核')
      if (bills) throw new BadRequestException('该采购单已有运费账单，不能撤回审核')
      if (payments || row.paymentStatus === 'paid' || row.paymentStatus === 'partial') throw new BadRequestException('该采购单已登记付款，请先清除打款后再撤回审核')
      await tx.costLedger.deleteMany({ where: { referenceNo: row.poNo } })
      return tx.purchaseOrder.update({
        where: { id: row.id },
        data: {
          status: 'pending_po_audit',
          paymentStatus: 'unpaid',
          paidAt: null,
          paidBy: null,
          poAuditRemark: reason,
        } as any,
        include: { items: true },
      })
    })
    const [item] = await this.enrichOrders([updated])
    await this.opLog.log({
      operatorId,
      module: 'purchase',
      action: 'po_reopen_audit',
      targetType: 'purchase_order',
      targetId: item.poNo,
      detail: { remark: reason, statusAfter: 'pending_po_audit' },
    })
    return item
  }

  /** 审核后只维护包装尺寸，保留审核、采购金额和付款记录。 */
  async updatePackageDimensions(id: number, body: UpdatePurchasePackageDto, user: AuthUser) {
    const dimensions = [body.packageLengthCm, body.packageWidthCm, body.packageHeightCm]
    if (dimensions.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0.01 || value > 999999.99 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-6)) {
      throw new BadRequestException('箱子长、宽、高须为大于零、最多两位小数的厘米数')
    }
    const volume = Math.round(dimensions.reduce((product, value) => product * value, 1)) / 1_000_000
    if (volume <= 0 || volume > 9999.999999) throw new BadRequestException('箱子体积超出支持范围，请核对长、宽、高及单位')
    const reason = String(body.reason || '').trim()
    if (reason.length < 2 || reason.length > 500) throw new BadRequestException('请填写 2 至 500 字的修改原因')
    const expectedTime = new Date(body.expectedUpdatedAt).getTime()
    if (!Number.isFinite(expectedTime)) throw new BadRequestException('请重新读取采购单后修改尺寸')
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM purchase_order WHERE id = ${BigInt(id)} FOR UPDATE`
      const order = await tx.purchaseOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true } })
      if (!order) throw new NotFoundException('采购单不存在')
      if (!['finance_approved', 'approved', 'at_logistics_wh', 'received'].includes(order.status)) {
        throw new BadRequestException('仅采购主管审核通过后的采购单可以直接修改箱子尺寸')
      }
      if (!order.prePoId) throw new BadRequestException('该采购单缺少采购确认信息，请联系管理员核对')
      await tx.$queryRaw`SELECT id FROM pre_purchase_order WHERE id = ${order.prePoId} FOR UPDATE`
      const confirmation = await tx.prePurchaseOrder.findUnique({ where: { id: order.prePoId } })
      if (!confirmation || confirmation.convertedPoId !== order.id || confirmation.status !== 'confirmed' || order.items.length !== 1 || order.items[0].sku !== confirmation.sku) {
        throw new BadRequestException('采购确认信息与订单不一致，请重新读取后核对')
      }
      if (confirmation.updatedAt.getTime() !== expectedTime) {
        throw new ConflictException('采购确认信息已被修改，请重新读取采购单后核对尺寸')
      }
      const patch = {
        packageLengthCm: body.packageLengthCm,
        packageWidthCm: body.packageWidthCm,
        packageHeightCm: body.packageHeightCm,
        packageVolumeCbm: volume,
        volumetricWeightKg: Math.round(volume * 167 * 1000) / 1000,
      }
      const before = this.serializePurchaseConfirmation(confirmation)!
      await tx.prePurchaseOrder.update({ where: { id: confirmation.id }, data: patch })
      await tx.productDev.update({ where: { id: confirmation.devId }, data: {
        packageLengthCm: patch.packageLengthCm, packageWidthCm: patch.packageWidthCm, packageHeightCm: patch.packageHeightCm,
        cbm: patch.packageVolumeCbm, volumetricWeightKg: patch.volumetricWeightKg,
      } })
      // 只更新申报尺寸；仓库实测尺寸和已生成的发运、计费快照保留原值。
      await tx.product.update({ where: { sku: confirmation.sku }, data: {
        lengthCm: patch.packageLengthCm, widthCm: patch.packageWidthCm, heightCm: patch.packageHeightCm, syncStatus: 'pending',
      } })
      await tx.operationLog.create({ data: {
        operatorId: BigInt(user.userId), operatorName: user.realName || user.username,
        module: 'purchase', action: 'po_package_dimensions', targetType: 'purchase_order', targetId: order.poNo,
        detail: { reason, sku: confirmation.sku, status: order.status,
          before: { packageLengthCm: before.packageLengthCm, packageWidthCm: before.packageWidthCm, packageHeightCm: before.packageHeightCm,
            packageVolumeCbm: before.packageVolumeCbm, volumetricWeightKg: before.volumetricWeightKg }, after: patch },
      } })
    })
    return this.detail(id)
  }

  /** 待审核采购单可改供应商、仓库、数量和单价，保存后仍停留在待审核。 */
  async revisePendingAudit(id: number, data: any, operatorId?: number) {
    const lines = Array.isArray(data?.items) ? data.items : Array.isArray(data?.lines) ? data.lines : []
    if (!lines.length) throw new BadRequestException('请保留至少一条采购明细')
    const prepared = lines.map((line: any) => {
      const quantity = Number(line.quantity ?? line.qty ?? 0)
      const unitPrice = Number(line.unitPrice ?? 0)
      const sku = String(line.sku || '').trim()
      const productName = String(line.productName || line.name || '').trim()
      if (!sku) throw new BadRequestException('SKU 不能为空')
      if (sku.length > 30) throw new BadRequestException('SKU 不能超过 30 字')
      if (!productName) throw new BadRequestException('请填写商品名称')
      if (!Number.isSafeInteger(quantity) || quantity < 1) throw new BadRequestException('采购数量须为大于零的整数')
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new BadRequestException('请填写大于零的采购单价')
      return {
        id: line.id != null && line.id !== '' ? BigInt(line.id) : null,
        sku,
        productName,
        quantity,
        unitPrice,
        remark: line.remark ? String(line.remark).slice(0, 500) : null,
        productId: line.productId,
      }
    })
    const warehouseCode = String(data.warehouseCode || '').trim()
    if (!warehouseCode) throw new BadRequestException('请选择目标中转仓')
    const supplierName = String(data.supplierName || '').trim()
    if (!supplierName) throw new BadRequestException('请选择或填写供应商')
    const orderDomestic = data.domesticFreight != null && data.domesticFreight !== '' ? Number(data.domesticFreight) : 0
    if (!Number.isFinite(orderDomestic) || orderDomestic < 0) throw new BadRequestException('国内运费须为不小于 0 的金额')
    const totalQty = prepared.reduce((sum, line) => sum + line.quantity, 0)
    const totalAmount = Math.round(prepared.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM purchase_order WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.purchaseOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true } })
      if (!row) throw new NotFoundException('采购单不存在')
      if (row.status !== 'pending_po_audit') throw new BadRequestException('仅待审核的采购单可以修改，请先撤回到待审核')
      const warehouse = await tx.warehouse.findUnique({ where: { warehouseCode } })
      if (!warehouse || warehouse.status !== 1 || warehouse.warehouseType !== 'logistics') throw new BadRequestException('请选择有效且启用的物流中转仓')
      const supplierId = await this.resolveSupplierForCreate({ supplierName, supplierId: row.supplierId })
      const kept = new Set(prepared.filter((line) => line.id).map((line) => String(line.id)))
      for (const existing of row.items) {
        if (!kept.has(String(existing.id))) {
          if ((existing.receivedQty ?? 0) > 0) throw new BadRequestException(`明细 ${existing.sku} 已有收货数量，不能删除`)
          await tx.purchaseOrderItem.delete({ where: { id: existing.id } })
        }
      }
      for (const line of prepared) {
        const lineDomestic = orderDomestic > 0 && totalQty > 0
          ? Math.round((orderDomestic * line.quantity) / totalQty * 100) / 100
          : null
        const amount = Math.round(line.quantity * line.unitPrice * 100) / 100
        const itemData = {
          sku: line.sku,
          productName: line.productName,
          quantity: line.quantity,
          plannedQty: line.quantity,
          unitPrice: line.unitPrice,
          amount,
          domesticFreight: lineDomestic,
          remark: line.remark,
        }
        if (line.id) {
          const current = row.items.find((item) => item.id === line.id)
          if (!current) throw new BadRequestException('采购明细已变化，请刷新后再修改')
          await tx.purchaseOrderItem.update({ where: { id: line.id }, data: itemData })
        } else {
          await tx.purchaseOrderItem.create({ data: { ...itemData, poId: row.id, productId: BigInt(line.productId || 0) } })
        }
      }
      return tx.purchaseOrder.update({
        where: { id: row.id },
        data: {
          supplierId,
          warehouseCode,
          expectedArrival: data.expectedArrival ? new Date(data.expectedArrival) : null,
          domesticFreight: orderDomestic > 0 ? orderDomestic : null,
          remark: data.remark != null ? String(data.remark) : row.remark,
          totalAmount,
        },
        include: { items: true },
      })
    })
    const [item] = await this.enrichOrders([updated])
    await this.opLog.log({
      operatorId,
      module: 'purchase',
      action: 'po_revise',
      targetType: 'purchase_order',
      targetId: item.poNo,
      detail: { totalAmount, itemCount: prepared.length },
    })
    return item
  }

  /** 已驳回或草稿的采购单改为废订单，保留单据，不再进入分配和审核。 */
  async voidOrder(id: number, operatorId?: number) {
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM purchase_order WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.purchaseOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true } })
      if (!row) throw new NotFoundException('采购单不存在')
      if (row.status === 'voided') throw new BadRequestException('该采购单已是废订单')
      if (!['rejected', 'draft'].includes(row.status)) throw new BadRequestException('仅已驳回或草稿的采购单可以标为废订单')
      if (row.items.some((line) => (line.receivedQty ?? 0) > 0)) throw new BadRequestException('该采购单已有收货记录，不能标为废订单')
      const [receipts, inbounds, bills, costs] = await Promise.all([
        tx.logisticsReceipt.count({ where: { poId: row.id } }),
        tx.inboundOrder.count({ where: { poId: row.id } }),
        tx.supplierFreightBill.count({ where: { poId: row.id } }),
        tx.costLedger.count({ where: { referenceNo: row.poNo } }),
      ])
      if (receipts || inbounds || bills || costs) throw new BadRequestException('该采购单已有收货、入库或费用记录，不能标为废订单')
      if (row.prePoId) {
        const prePo = await tx.prePurchaseOrder.findUnique({ where: { id: row.prePoId } })
        if (prePo?.convertedPoId === row.id && ['returned', 'assigned', 'pending_assign', 'confirmed'].includes(prePo.status)) {
          await tx.prePurchaseOrder.update({
            where: { id: prePo.id },
            data: { status: 'cancelled', cancelReason: prePo.cancelReason || '关联采购单已标为废订单', convertedPoId: null },
          })
        }
      }
      return tx.purchaseOrder.update({
        where: { id: row.id },
        data: { status: 'voided' },
        include: { items: true },
      })
    })
    const [item] = await this.enrichOrders([updated])
    await this.opLog.log({
      operatorId,
      module: 'purchase',
      action: 'void',
      targetType: 'purchase_order',
      targetId: item.poNo,
      detail: { statusAfter: 'voided' },
    })
    return item
  }

  async remove(id: number, operatorId?: number) {
    return this.voidOrder(id, operatorId)
  }
}
