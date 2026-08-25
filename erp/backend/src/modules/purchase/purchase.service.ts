import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { OperationLogService } from '../operation-log/operation-log.service'
import { allocatePoDomesticFreight } from '../../common/po-domestic-freight.util'
import { computePoFinanceApprovalCosts } from '../../common/po-finance-cost.util'

function fmtTime(d: Date | null | undefined): string {
  if (!d) return ''
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
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
    if (!rows.length) return []
    const supplierIds = [...new Set(rows.map((r) => r.supplierId))]
    const userIds = [
      ...new Set(
        rows.flatMap((r) => [r.purchaserId, r.auditorId, r.financeId, r.paidBy].filter(Boolean)),
      ),
    ] as bigint[]
    const whCodes = [...new Set(rows.map((r) => r.warehouseCode).filter(Boolean))] as string[]

    const [suppliers, users, warehouses] = await Promise.all([
      this.prisma.supplier.findMany({ where: { id: { in: supplierIds } } }),
      userIds.length ? this.prisma.sysUser.findMany({ where: { id: { in: userIds } } }) : [],
      whCodes.length ? this.prisma.warehouse.findMany({ where: { warehouseCode: { in: whCodes } } }) : [],
    ])
    const supMap = new Map<number, string>(suppliers.map((s) => [Number(s.id), s.supplierName] as [number, string]))
    const userMap = new Map<number, string>(users.map((u) => [Number(u.id), u.realName] as [number, string]))
    const whMap = new Map<string, string>(warehouses.map((w) => [w.warehouseCode, w.warehouseName] as [string, string]))

    return rows.map((row) => this.serialize(row, supMap, userMap, whMap))
  }

  private serialize(row: any, supMap: Map<number, string>, userMap: Map<number, string>, whMap: Map<string, string>) {
    return {
      id: Number(row.id),
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
      paymentStatus: row.paymentStatus === 'paid' ? 'paid' : 'unpaid',
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
        product = await tx.product.create({
          data: {
            sku,
            productName: row.productName,
            spec: row.spec ?? undefined,
            lengthCm: row.packageLengthCm ?? row.productLengthCm ?? undefined,
            widthCm: row.packageWidthCm ?? row.productWidthCm ?? undefined,
            heightCm: row.packageHeightCm ?? row.productHeightCm ?? undefined,
            weightKg: row.volumetricWeightKg ?? undefined,
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
        where: { sku: { in: skus }, order: { status: { notIn: ['rejected', 'draft'] } } },
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

    const orderDomestic = data.domesticFreight != null && data.domesticFreight !== '' ? Number(data.domesticFreight) : 0
    const totalQty = lines.reduce((s, l) => s + (Number(l.quantity ?? l.qty ?? 0) || 0), 0)

    const items = lines.map((l) => {
      const quantity = Number(l.quantity ?? l.qty ?? 0)
      const unitPrice = Number(l.unitPrice ?? 0)
      const plannedQty = l.plannedQty != null && l.plannedQty !== '' ? Number(l.plannedQty) : undefined
      let lineDomestic = l.domesticFreight != null && l.domesticFreight !== '' ? Number(l.domesticFreight) : undefined
      if (lineDomestic == null && orderDomestic > 0 && totalQty > 0) {
        lineDomestic = Math.round((orderDomestic * quantity) / totalQty * 100) / 100
      }
      return {
        productId: BigInt(l.productId ?? 0),
        sku: l.sku ?? '',
        productName: l.productName ?? l.name,
        plannedQty,
        quantity,
        unitPrice,
        amount: quantity * unitPrice,
        domesticFreight: lineDomestic,
        remark: l.remark,
      }
    })
    const totalAmount = items.reduce((s, i) => s + i.amount, 0)
    const row = await this.prisma.purchaseOrder.create({
      data: {
        poNo: data.poNo || 'PO-' + Date.now().toString().slice(-8),
        supplierId,
        warehouseCode: data.warehouseCode,
        currency: data.currency || 'RMB',
        expectedArrival: data.expectedArrival ? new Date(data.expectedArrival) : undefined,
        remark: data.remark,
        status: 'pending_po_audit',
        totalAmount,
        domesticFreight: orderDomestic > 0 ? orderDomestic : undefined,
        purchaserId: purchaserId ? BigInt(purchaserId) : undefined,
        items: { create: items },
      },
      include: { items: true },
    })
    const [item] = await this.enrichOrders([row])
    await this.opLog.log({
      operatorId: purchaserId,
      module: 'purchase',
      action: 'create',
      targetType: 'purchase_order',
      targetId: item.poNo,
      detail: { supplierName: item.supplierName, totalAmount: item.totalAmount, itemCount: item.items?.length },
    })
    return item
  }

  async approve(id: number, auditorId?: number, remark?: string, warehouseCode?: string) {
    const row = await this.detail(id)
    if (row.status !== 'pending_po_audit') throw new BadRequestException('当前状态不可进行采购审核')
    const auditWarehouseCode = String(warehouseCode || '').trim()
    const targetWarehouseCode = row.warehouseCode || auditWarehouseCode
    if (!targetWarehouseCode) throw new BadRequestException('请先补充目标中转仓后再审核通过')
    if (!row.warehouseCode) {
      const warehouse = await this.prisma.warehouse.findUnique({ where: { warehouseCode: targetWarehouseCode } })
      if (!warehouse || warehouse.warehouseType !== 'logistics') {
        throw new BadRequestException('请选择有效的物流中转仓')
      }
    }
    const source = !row.warehouseCode
      ? await this.prisma.purchaseOrder.findUnique({ where: { id: BigInt(id) }, select: { prePoId: true } })
      : null
    const updated = await this.prisma.$transaction(async (tx) => {
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
      if (!row.warehouseCode && source?.prePoId) {
        await tx.prePurchaseOrder.update({
          where: { id: source.prePoId },
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
      detail: { remark: remark || '审核通过', warehouseCode: targetWarehouseCode, statusAfter: item.status },
    })
    return item
  }

  async rejectPoAudit(id: number, auditorId?: number, remark?: string) {
    const row = await this.detail(id)
    if (row.status !== 'pending_po_audit') throw new BadRequestException('当前状态不可驳回')
    if (!remark?.trim()) throw new BadRequestException('请填写驳回原因')
    const updated = await this.prisma.purchaseOrder.update({
      where: { id: BigInt(id) },
      data: {
        status: 'rejected',
        auditorId: auditorId ? BigInt(auditorId) : undefined,
        auditedAt: new Date(),
        poAuditRemark: remark.trim(),
      } as any,
      include: { items: true },
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
    const row = await this.prisma.purchaseOrder.findUnique({
      where: { id: BigInt(id) },
      include: { items: true },
    })
    if (!row) throw new NotFoundException('采购单不存在')
    if (row.status !== 'pending_actual_qty') throw new BadRequestException('当前状态不可核定实际采购数量')

    const qty = Number(body.quantity)
    if (!qty || qty <= 0) throw new BadRequestException('请填写实际采购数量')

    const line = row.items[0]
    if (!line) throw new BadRequestException('采购明细为空')

    const unitPrice = Number(line.unitPrice)
    const amount = qty * unitPrice
    const orderDomestic = row.domesticFreight != null ? Number(row.domesticFreight) : 0
    let lineDomestic = line.domesticFreight != null ? Number(line.domesticFreight) : undefined
    if (lineDomestic == null && orderDomestic > 0) {
      lineDomestic = orderDomestic
    }

    const updated = await this.prisma.purchaseOrder.update({
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

    const [item] = await this.enrichOrders([updated])
    await this.opLog.log({
      operatorId,
      module: 'purchase',
      action: 'set_actual_qty',
      targetType: 'purchase_order',
      targetId: item.poNo,
      detail: { sku: line.sku, plannedQty: line.plannedQty, actualQty: qty },
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
      weightKg: prePo?.packageWeightKg ?? prePo?.volumetricWeightKg ?? dev?.volumetricWeightKg ?? undefined,
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

      const pricingData = {
        productName: line.productName || line.sku,
        costRmb: unitPrice,
        purchaseQty: qty,
        poNo: po.poNo,
        domesticFee: domesticPerUnit,
      }
      const existing = await tx.productPricing.findUnique({ where: { sku: line.sku } })
      if (existing) {
        await tx.productPricing.update({ where: { sku: line.sku }, data: pricingData })
      } else {
        await tx.productPricing.create({
          data: {
            sku: line.sku,
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

  async setPaymentStatus(id: number, paid: boolean, operatorId?: number, remark?: string) {
    const row = await this.detail(id)
    const markable = ['finance_approved', 'at_logistics_wh', 'received', 'completed', 'approved']
    if (!markable.includes(row.status)) {
      throw new BadRequestException('采购审核通过后才能标记打款状态')
    }
    const next = paid ? 'paid' : 'unpaid'
    if (row.paymentStatus === next) {
      throw new BadRequestException(paid ? '该采购单已是已打款' : '该采购单已是未打款')
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.update({
        where: { id: BigInt(id) },
        data: {
          paymentStatus: next,
          paidAt: paid ? new Date() : null,
          paidBy: paid && operatorId ? BigInt(operatorId) : null,
          financeRemark: remark?.trim() || row.financeRemark || undefined,
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
        paymentStatus: next,
        remark: remark?.trim() || (paid ? '已标记已打款' : '已标记未打款'),
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

  async remove(id: number, operatorId?: number) {
    const row = await this.detail(id)
    await this.prisma.purchaseOrderItem.deleteMany({ where: { poId: BigInt(id) } })
    await this.prisma.purchaseOrder.delete({ where: { id: BigInt(id) } })
    await this.opLog.log({
      operatorId,
      module: 'purchase',
      action: 'delete',
      targetType: 'purchase_order',
      targetId: row.poNo,
    })
    return { id }
  }
}
