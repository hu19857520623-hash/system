import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { OperationLogService } from '../operation-log/operation-log.service'

function fmtTime(d: Date | null | undefined): string {
  if (!d) return ''
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return ''
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

@Injectable()
export class PrePurchaseService {
  constructor(
    private prisma: PrismaService,
    private opLog: OperationLogService,
  ) {}

  private static numberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null
    const numberValue = Number(value)
    return Number.isFinite(numberValue) ? numberValue : null
  }

  private static calculateCbm(length?: unknown, width?: unknown, height?: unknown): number | null {
    const values = [length, width, height].map(PrePurchaseService.numberOrNull)
    if (values.every((value) => value == null)) return null
    if (values.some((value) => value == null || value <= 0)) {
      throw new BadRequestException('请填写完整且大于零的长、宽、高')
    }
    return Math.round((values[0]! * values[1]! * values[2]!) / 1_000_000 * 1_000_000) / 1_000_000
  }

  /** Reuse a matching supplier, or create a supplier record for a manually entered name. */
  private async resolveSupplier(data: any, fallbackSupplierId: bigint | null | undefined, db: Prisma.TransactionClient): Promise<bigint | null> {
    const suppliedName = data.supplierName == null ? '' : String(data.supplierName).trim()
    if (!suppliedName) {
      if (data.supplierId) {
        const supplier = await db.supplier.findUnique({ where: { id: BigInt(data.supplierId) } })
        if (!supplier || supplier.status !== 1) throw new BadRequestException('请选择有效且未停用的供应商')
      }
      return data.supplierId ? BigInt(data.supplierId) : fallbackSupplierId ?? null
    }

    const profile: any = {}
    if (data.supplierContactName != null && String(data.supplierContactName).trim()) profile.contactName = String(data.supplierContactName).trim()
    if (data.supplierContactPhone != null && String(data.supplierContactPhone).trim()) profile.contactPhone = String(data.supplierContactPhone).trim()
    if (data.supplierAddress != null && String(data.supplierAddress).trim()) profile.address = String(data.supplierAddress).trim()

    const existing = await db.supplier.findFirst({ where: { supplierName: suppliedName }, orderBy: { id: 'asc' } })
    if (existing) {
      if (existing.status !== 1) throw new BadRequestException('供应商已停用，请核对后选择有效供应商')
      if (Object.keys(profile).length) await db.supplier.update({ where: { id: existing.id }, data: profile })
      return existing.id
    }

    const supplierCode = `SUP-${Date.now()}-${Math.floor(Math.random() * 1000)}`.slice(0, 30)
    const created = await db.supplier.create({ data: { supplierCode, supplierName: suppliedName, paymentTerms: '现结', ...profile } })
    return created.id
  }

  /** 产品审核通过后创建预采购单 */
  async createFromDev(dev: {
    id: bigint
    applyNo: string
    productName: string
    spec?: string | null
    sku: string
    purchaseQty: number
    estimatedCost?: unknown
  }, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma
    const existing = await db.prePurchaseOrder.findFirst({
      where: { devId: dev.id, status: { notIn: ['cancelled', 'confirmed'] } },
    })
    if (existing) return existing

    return db.prePurchaseOrder.create({
      data: {
        prePoNo: `PRE-${dev.sku}`,
        devId: dev.id,
        applyNo: dev.applyNo,
        sku: dev.sku,
        productName: dev.productName,
        spec: dev.spec ?? undefined,
        plannedQty: dev.purchaseQty,
        unitPrice: dev.estimatedCost != null ? Number(dev.estimatedCost) : undefined,
        status: 'pending_assign',
      },
    })
  }

  private async enrich(rows: any[]) {
    if (!rows.length) return []
    const supplierIds = [...new Set(rows.map((r) => r.supplierId).filter(Boolean))] as bigint[]
    const poIds = [...new Set(rows.map((r) => r.convertedPoId).filter(Boolean))] as bigint[]
    const userIds = [
      ...new Set(rows.flatMap((r) => [r.purchaserId, r.assignerId].filter(Boolean))),
    ] as bigint[]
    const [suppliers, users, purchaseOrders] = await Promise.all([
      supplierIds.length
        ? this.prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, supplierName: true } })
        : Promise.resolve([] as { id: bigint; supplierName: string }[]),
      userIds.length
        ? this.prisma.sysUser.findMany({ where: { id: { in: userIds } }, select: { id: true, realName: true } })
        : Promise.resolve([] as { id: bigint; realName: string }[]),
      poIds.length
        ? this.prisma.purchaseOrder.findMany({ where: { id: { in: poIds } }, select: { id: true, status: true, poNo: true, poAuditRemark: true } })
        : Promise.resolve([] as { id: bigint; status: string; poNo: string; poAuditRemark: string | null }[]),
    ])
    const supMap = new Map<number, string>()
    suppliers.forEach((s) => supMap.set(Number(s.id), s.supplierName))
    const userMap = new Map<number, string>()
    users.forEach((u) => userMap.set(Number(u.id), u.realName))
    const poMap = new Map(purchaseOrders.map((order) => [Number(order.id), order]))
    return rows.map((r) => this.serialize(r, supMap, userMap, poMap.get(Number(r.convertedPoId))))
  }

  private serialize(row: any, supMap: Map<number, string>, userMap: Map<number, string>, linkedPo?: { status: string; poNo: string; poAuditRemark: string | null }) {
    return {
      id: Number(row.id),
      prePoNo: row.prePoNo,
      devId: Number(row.devId),
      applyNo: row.applyNo,
      sku: row.sku,
      productName: row.productName,
      spec: row.spec || '',
      plannedQty: row.plannedQty,
      unitPrice: row.unitPrice != null ? Number(row.unitPrice) : null,
      supplierId: row.supplierId ? Number(row.supplierId) : null,
      supplierContactName: row.supplierContactName || '',
      supplierContactPhone: row.supplierContactPhone || '',
      supplierAddress: row.supplierAddress || '',
      productLink: row.productLink || '',
      accessories: row.accessories || '',
      productImageUrl: row.productImageUrl || '',
      manualUrl: row.manualUrl || '',
      moq: row.moq ?? null,
      leadTimeDays: row.leadTimeDays ?? null,
      taxRate: row.taxRate != null ? Number(row.taxRate) : null,
      invoiceTaxRate: row.invoiceTaxRate != null ? Number(row.invoiceTaxRate) : null,
      unitTax: row.unitTax != null ? Number(row.unitTax) : null,
      unitFreight: row.unitFreight != null ? Number(row.unitFreight) : null,
      productLengthCm: row.productLengthCm != null ? Number(row.productLengthCm) : null,
      productWidthCm: row.productWidthCm != null ? Number(row.productWidthCm) : null,
      productHeightCm: row.productHeightCm != null ? Number(row.productHeightCm) : null,
      productVolumeCbm: row.productVolumeCbm != null ? Number(row.productVolumeCbm) : null,
      packageWeightKg: row.packageWeightKg != null ? Number(row.packageWeightKg) : null,
      packageLengthCm: row.packageLengthCm != null ? Number(row.packageLengthCm) : null,
      packageWidthCm: row.packageWidthCm != null ? Number(row.packageWidthCm) : null,
      packageHeightCm: row.packageHeightCm != null ? Number(row.packageHeightCm) : null,
      packageVolumeCbm: row.packageVolumeCbm != null ? Number(row.packageVolumeCbm) : null,
      volumetricWeightKg: row.volumetricWeightKg != null ? Number(row.volumetricWeightKg) : null,
      sampleStatus: row.sampleStatus || '',
      samplePackageInfo: row.samplePackageInfo || '',
      sampleImageUrl: row.sampleImageUrl || '',
      doubleLayerCarton: row.doubleLayerCarton ?? null,
      notPurchaseReason: row.notPurchaseReason || '',
      logoUnitFee: row.logoUnitFee != null ? Number(row.logoUnitFee) : null,
      logoTotalFee: row.logoTotalFee != null ? Number(row.logoTotalFee) : null,
      cartonTotalPrice: row.cartonTotalPrice != null ? Number(row.cartonTotalPrice) : null,
      spareCartonUnitPrice: row.spareCartonUnitPrice != null ? Number(row.spareCartonUnitPrice) : null,
      spareCartonQty: row.spareCartonQty ?? null,
      piecesPerCarton: row.piecesPerCarton ?? null,
      supplierName: row.supplierId ? supMap.get(Number(row.supplierId)) || '—' : '—',
      domesticFreight: row.domesticFreight != null ? Number(row.domesticFreight) : null,
      warehouseCode: row.warehouseCode || '',
      currency: row.currency || 'RMB',
      expectedArrival: row.expectedArrival,
      expectedArrivalStr: fmtDate(row.expectedArrival),
      purchaserId: row.purchaserId ? Number(row.purchaserId) : null,
      purchaserName: row.purchaserId ? userMap.get(Number(row.purchaserId)) || '—' : '—',
      assignerId: row.assignerId ? Number(row.assignerId) : null,
      assignerName: row.assignerId ? userMap.get(Number(row.assignerId)) || '—' : '—',
      assignedAtStr: fmtTime(row.assignedAt),
      status: row.status,
      cancelReason: row.cancelReason || '',
      remark: row.remark || '',
      convertedPoId: row.convertedPoId ? Number(row.convertedPoId) : null,
      linkedPoNo: linkedPo?.poNo || '',
      linkedPoStatus: linkedPo?.status || '',
      linkedPoAuditRemark: linkedPo?.poAuditRemark || '',
      confirmedAtStr: fmtTime(row.confirmedAt),
      createdAtStr: fmtTime(row.createdAt),
    }
  }

  async listPendingAssign(q: PaginationDto & { keyword?: string }) {
    const { page, pageSize } = getPagination(q)
    const keyword = q.keyword?.trim()
    const where: any = { status: 'pending_assign' }
    if (keyword) {
      where.OR = [
        { sku: { contains: keyword } },
        { productName: { contains: keyword } },
        { applyNo: { contains: keyword } },
        { prePoNo: { contains: keyword } },
      ]
    }
    const [rows, total] = await Promise.all([
      this.prisma.prePurchaseOrder.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.prePurchaseOrder.count({ where }),
    ])
    const items = await this.enrich(rows)
    return { items, total, page, pageSize }
  }

  async listMy(q: PaginationDto & { keyword?: string; status?: string }, viewer?: { userId: number; roleCode: string }) {
    const { page, pageSize } = getPagination(q)
    const keyword = q.keyword?.trim()
    const status = q.status || 'assigned'
    if (!['assigned', 'cancelled', 'confirmed', 'all'].includes(status)) throw new BadRequestException('请选择有效的预采购处理状态')
    const where: any = {
      status: status === 'all'
        ? { in: ['assigned', 'returned', 'cancelled', 'confirmed'] }
        : status === 'assigned'
          ? { in: ['assigned', 'returned'] }
          : status,
    }
    if (viewer?.roleCode === 'purchaser') {
      where.purchaserId = BigInt(viewer.userId)
    }
    if (keyword) {
      where.OR = [
        { sku: { contains: keyword } },
        { productName: { contains: keyword } },
        { prePoNo: { contains: keyword } },
      ]
    }
    const [rows, total] = await Promise.all([
      this.prisma.prePurchaseOrder.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.prePurchaseOrder.count({ where }),
    ])
    const items = await this.enrich(rows)
    return { items, total, page, pageSize }
  }

  async detail(id: number) {
    const row = await this.prisma.prePurchaseOrder.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('预采购单不存在')
    const [item] = await this.enrich([row])
    return item
  }

  async assign(id: number, purchaserId: number, operatorId?: number) {
    const row = await this.prisma.prePurchaseOrder.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('预采购单不存在')
    if (row.status !== 'pending_assign') throw new BadRequestException('仅待分配状态可分配采购员')

    const purchaser = await this.prisma.sysUser.findUnique({ where: { id: BigInt(purchaserId) } })
    if (!purchaser || purchaser.roleCode !== 'purchaser' || purchaser.status !== 1) {
      throw new BadRequestException('请选择有效的采购员')
    }

    const changed = await this.prisma.prePurchaseOrder.updateMany({
      where: { id: BigInt(id), status: 'pending_assign' },
      data: {
        status: 'assigned',
        purchaserId: BigInt(purchaserId),
        assignerId: operatorId ? BigInt(operatorId) : undefined,
        assignedAt: new Date(),
      },
    })
    if (changed.count !== 1) throw new ConflictException('预采购单状态已变化，请刷新核对后再分配')
    const updated = await this.prisma.prePurchaseOrder.findUniqueOrThrow({ where: { id: BigInt(id) } })
    await this.opLog.log({
      operatorId,
      module: 'purchase',
      action: 'assign_pre_po',
      targetType: 'pre_purchase_order',
      targetId: row.prePoNo,
      detail: { sku: row.sku, purchaserId, purchaserName: purchaser.realName },
    })
    const [item] = await this.enrich([updated])
    return item
  }

  async update(id: number, data: any, viewer?: { userId: number; roleCode: string }) {
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM pre_purchase_order WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.prePurchaseOrder.findUnique({ where: { id: BigInt(id) } })
      if (!row) throw new NotFoundException('预采购单不存在')
      if (row.status !== 'assigned' && row.status !== 'returned') throw new BadRequestException('仅进行中或退回修改的预采购单可编辑')
      if (viewer?.roleCode === 'purchaser' && Number(row.purchaserId) !== viewer.userId) {
        throw new ForbiddenException('无权编辑未分配给您的预采购单')
      }

      const patch: any = {}
      if (data.sku != null) {
        const sku = String(data.sku).trim()
        if (!sku) throw new BadRequestException('SKU 不能为空')
        const [dupProduct, dupDev] = await Promise.all([
          tx.product.findFirst({ where: { sku, NOT: { sku: row.sku } } }),
          tx.productDev.findFirst({ where: { sku, NOT: { id: row.devId } } }),
        ])
        if (dupProduct || dupDev) throw new BadRequestException(`SKU ${sku} 已被使用`)
        patch.sku = sku
      }
      if (data.productName != null) {
        if (!String(data.productName).trim()) throw new BadRequestException('请填写商品名称')
        patch.productName = String(data.productName).trim()
      }
      if (data.spec != null) patch.spec = String(data.spec).trim() || null
      if (data.plannedQty != null) patch.plannedQty = Number(data.plannedQty)
      if (data.unitPrice != null && data.unitPrice !== '') patch.unitPrice = Number(data.unitPrice)
      if (data.domesticFreight != null && data.domesticFreight !== '') patch.domesticFreight = Number(data.domesticFreight)
      if (data.warehouseCode != null) {
        if (data.warehouseCode) {
          const warehouse = await tx.warehouse.findUnique({ where: { warehouseCode: data.warehouseCode } })
          if (!warehouse || warehouse.status !== 1 || warehouse.warehouseType !== 'logistics') throw new BadRequestException('请选择有效的国内中转收货仓库')
        }
        patch.warehouseCode = data.warehouseCode || null
      }
      if (data.currency != null) patch.currency = data.currency
      if (data.expectedArrival != null) patch.expectedArrival = data.expectedArrival ? new Date(data.expectedArrival) : null
      if (data.remark != null) patch.remark = data.remark

      const textFields = [
        'supplierContactName', 'supplierContactPhone', 'supplierAddress', 'productLink', 'accessories', 'productImageUrl', 'manualUrl',
        'sampleStatus', 'samplePackageInfo', 'sampleImageUrl', 'notPurchaseReason',
      ]
      for (const field of textFields) if (data[field] != null) patch[field] = String(data[field]).trim() || null
      const integerFields = ['moq', 'leadTimeDays', 'spareCartonQty', 'piecesPerCarton']
      for (const field of integerFields) if (data[field] != null && data[field] !== '') patch[field] = Math.max(0, Math.trunc(Number(data[field])))
      const decimalFields = ['taxRate', 'invoiceTaxRate', 'unitTax', 'unitFreight', 'packageWeightKg', 'logoUnitFee', 'logoTotalFee', 'cartonTotalPrice', 'spareCartonUnitPrice']
      for (const field of decimalFields) if (data[field] != null && data[field] !== '') patch[field] = Number(data[field])
      if (data.doubleLayerCarton != null) patch.doubleLayerCarton = Boolean(data.doubleLayerCarton)

      const productLengthCm = data.productLengthCm !== undefined ? data.productLengthCm : row.productLengthCm
      const productWidthCm = data.productWidthCm !== undefined ? data.productWidthCm : row.productWidthCm
      const productHeightCm = data.productHeightCm !== undefined ? data.productHeightCm : row.productHeightCm
      const packageLengthCm = data.packageLengthCm !== undefined ? data.packageLengthCm : row.packageLengthCm
      const packageWidthCm = data.packageWidthCm !== undefined ? data.packageWidthCm : row.packageWidthCm
      const packageHeightCm = data.packageHeightCm !== undefined ? data.packageHeightCm : row.packageHeightCm
      const productVolumeCbm = PrePurchaseService.calculateCbm(productLengthCm, productWidthCm, productHeightCm)
      const packageVolumeCbm = PrePurchaseService.calculateCbm(packageLengthCm, packageWidthCm, packageHeightCm)
      if ([data.productLengthCm, data.productWidthCm, data.productHeightCm].some((value) => value !== undefined)) {
        patch.productLengthCm = PrePurchaseService.numberOrNull(productLengthCm)
        patch.productWidthCm = PrePurchaseService.numberOrNull(productWidthCm)
        patch.productHeightCm = PrePurchaseService.numberOrNull(productHeightCm)
        patch.productVolumeCbm = productVolumeCbm
      }
      if ([data.packageLengthCm, data.packageWidthCm, data.packageHeightCm].some((value) => value !== undefined)) {
        patch.packageLengthCm = PrePurchaseService.numberOrNull(packageLengthCm)
        patch.packageWidthCm = PrePurchaseService.numberOrNull(packageWidthCm)
        patch.packageHeightCm = PrePurchaseService.numberOrNull(packageHeightCm)
        patch.packageVolumeCbm = packageVolumeCbm
        patch.volumetricWeightKg = packageVolumeCbm == null ? null : Math.round(packageVolumeCbm * 167 * 1000) / 1000
      }

      // Supplier changes belong to the same transaction as the purchase form.
      const supplierId = await this.resolveSupplier(data, row.supplierId, tx)
      if (data.supplierName != null || data.supplierId != null) patch.supplierId = supplierId
      const saved = await tx.prePurchaseOrder.update({ where: { id: BigInt(id) }, data: patch })
      if (patch.sku && patch.sku !== row.sku) {
        await tx.productDev.update({ where: { id: row.devId }, data: { sku: patch.sku } })
      }
      const devPatch: Record<string, unknown> = {}
      for (const field of ['spec', 'productLengthCm', 'productWidthCm', 'productHeightCm', 'packageLengthCm', 'packageWidthCm', 'packageHeightCm', 'packageVolumeCbm', 'volumetricWeightKg']) {
        if (patch[field] !== undefined) devPatch[field === 'packageVolumeCbm' ? 'cbm' : field] = patch[field]
      }
      if (Object.keys(devPatch).length) await tx.productDev.update({ where: { id: row.devId }, data: devPatch })
      return saved
    })
    const [item] = await this.enrich([updated])
    return item
  }

  async cancel(id: number, reason: string, viewer?: { userId: number; roleCode: string }) {
    const row = await this.prisma.prePurchaseOrder.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('预采购单不存在')
    if (row.status !== 'assigned') throw new BadRequestException('仅进行中的预采购单可取消')
    if (!reason?.trim()) throw new BadRequestException('请填写取消原因')
    if (viewer?.roleCode === 'purchaser' && Number(row.purchaserId) !== viewer.userId) {
      throw new ForbiddenException('无权取消未分配给您的预采购单')
    }

    const changed = await this.prisma.prePurchaseOrder.updateMany({
      where: { id: BigInt(id), status: 'assigned' },
      data: { status: 'cancelled', cancelReason: reason.trim() },
    })
    if (changed.count !== 1) throw new ConflictException('预采购单状态已变化，请刷新核对后再取消')
    const updated = await this.prisma.prePurchaseOrder.findUniqueOrThrow({ where: { id: BigInt(id) } })
    await this.opLog.log({
      operatorId: viewer?.userId,
      module: 'purchase',
      action: 'cancel_pre_po',
      targetType: 'pre_purchase_order',
      targetId: row.prePoNo,
      detail: { sku: row.sku, reason: reason.trim() },
    })
    const [item] = await this.enrich([updated])
    return item
  }

  /** 采购员确认 → 生成正式采购单（待产品主管填实际数量） */
  async confirm(id: number, viewer?: { userId: number; roleCode: string }) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM pre_purchase_order WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.prePurchaseOrder.findUnique({ where: { id: BigInt(id) } })
      if (!row) throw new NotFoundException('预采购单不存在')
      if (viewer?.roleCode === 'purchaser' && Number(row.purchaserId) !== viewer.userId) throw new ForbiddenException('无权确认未分配给您的预采购单')
      if (row.status === 'confirmed' && row.convertedPoId) {
        const existing = await tx.purchaseOrder.findUnique({ where: { id: row.convertedPoId } })
        if (!existing || existing.prePoId !== row.id) throw new ConflictException('采购转换结果异常，请联系管理员核对，请勿重复确认')
        return { po: existing, row, duplicate: true }
      }
      if (row.status !== 'assigned') throw new BadRequestException('仅已分配的预采购单可确认')
      if (!row.supplierId) throw new BadRequestException('请填写供应商')
      const supplier = await tx.supplier.findUnique({ where: { id: row.supplierId } })
      if (!supplier || supplier.status !== 1) throw new BadRequestException('供应商不存在或已停用，请修改后再确认')
      if (row.unitPrice == null || Number(row.unitPrice) <= 0) throw new BadRequestException('请填写采购单价')

      if (!row.spec?.trim()) throw new BadRequestException('请准确填写规格描述')
      if (!Number.isFinite(Number(row.productVolumeCbm)) || Number(row.productVolumeCbm) <= 0) throw new BadRequestException('请填写完整的产品尺寸（长、宽、高）')
      if (!Number.isFinite(Number(row.packageVolumeCbm)) || Number(row.packageVolumeCbm) <= 0) throw new BadRequestException('请填写完整的包装尺寸（长、宽、高）')
      if (!Number.isSafeInteger(row.plannedQty) || row.plannedQty <= 0) throw new BadRequestException('计划数量须为大于零的整数，请修改后再确认')

      const poNo = `PO-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`
      const unitPrice = Number(row.unitPrice)

      const lineData = {
        productId: BigInt(0), sku: row.sku, productName: row.productName,
        plannedQty: row.plannedQty, quantity: 0, unitPrice, amount: 0,
        domesticFreight: row.domesticFreight,
      }
      const orderData = {
          supplierId: row.supplierId!,
          warehouseCode: row.warehouseCode,
          currency: row.currency || 'RMB',
          expectedArrival: row.expectedArrival,
          remark: row.remark,
          domesticFreight: row.domesticFreight,
          status: 'pending_actual_qty',
          totalAmount: 0,
          purchaserId: row.purchaserId ?? (viewer?.userId ? BigInt(viewer.userId) : undefined),
          prePoId: row.id,
      }
      let po
      if (row.convertedPoId) {
        await tx.$queryRaw`SELECT id FROM purchase_order WHERE id = ${row.convertedPoId} FOR UPDATE`
        const rejected = await tx.purchaseOrder.findUnique({ where: { id: row.convertedPoId }, include: { items: true } })
        if (rejected?.status === 'rejected') {
          const assignedAt = row.assignedAt ? new Date(row.assignedAt).getTime() : 0
          const auditedAt = rejected.auditedAt ? new Date(rejected.auditedAt).getTime() : 0
          if (assignedAt <= auditedAt) throw new BadRequestException('采购单已驳回，请修改后重新提交，进入分配采购员')
        }
        if (!rejected || rejected.prePoId !== row.id || rejected.status !== 'rejected' || rejected.items.length !== 1 || rejected.items.some(line => (line.receivedQty ?? 0) > 0)) throw new ConflictException('原采购单状态已变化，请刷新核对后再提交')
        po = await tx.purchaseOrder.update({
          where: { id: rejected.id },
          data: { ...orderData, items: { update: { where: { id: rejected.items[0].id }, data: lineData } } },
          include: { items: true },
        })
      } else {
        po = await tx.purchaseOrder.create({ data: { ...orderData, poNo, items: { create: lineData } }, include: { items: true } })
      }

      await tx.prePurchaseOrder.update({
        where: { id: row.id },
        data: {
          status: 'confirmed',
          confirmedAt: new Date(),
          convertedPoId: po.id,
        },
      })

      return { po, row, duplicate: false }
    })

    if (!result.duplicate) await this.opLog.log({
      operatorId: viewer?.userId,
      module: 'purchase',
      action: 'confirm_pre_po',
      targetType: 'pre_purchase_order',
      targetId: result.row.prePoNo,
      detail: { poNo: result.po.poNo, sku: result.row.sku, plannedQty: result.row.plannedQty },
    })

    return { prePoId: id, poId: Number(result.po.id), poNo: result.po.poNo, status: result.po.status, duplicate: result.duplicate }
  }

  /** 已驳回采购单修改后重新提交，回到预采购分配，仍沿用原采购单号。 */
  async resubmitRejected(poId: number, data: any, viewer?: { userId: number; roleCode: string }) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id: BigInt(poId) } })
    if (!po) throw new NotFoundException('采购单不存在')
    if (po.status !== 'rejected') throw new BadRequestException('仅已驳回的采购单可修改后重新提交')
    if (!po.prePoId) throw new BadRequestException('该采购单没有关联预采购，无法退回分配采购员')

    await this.update(Number(po.prePoId), data, viewer)

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM pre_purchase_order WHERE id = ${po.prePoId} FOR UPDATE`
      const row = await tx.prePurchaseOrder.findUnique({ where: { id: po.prePoId! } })
      if (!row) throw new NotFoundException('预采购单不存在')
      if (row.status !== 'assigned' && row.status !== 'returned') throw new BadRequestException('预采购单状态已变化，请刷新后再提交')
      if (viewer?.roleCode === 'purchaser' && Number(row.purchaserId) !== viewer.userId) throw new ForbiddenException('无权提交未分配给您的预采购单')
      if (row.convertedPoId !== po.id) throw new BadRequestException('关联预采购单与采购单不一致，请联系管理员核对')
      const currentPo = await tx.purchaseOrder.findUnique({ where: { id: po.id } })
      if (!currentPo || currentPo.status !== 'rejected' || currentPo.prePoId !== row.id) throw new ConflictException('采购单状态已变化，请刷新核对后再提交')
      const changed = await tx.prePurchaseOrder.updateMany({
        where: { id: row.id, status: { in: ['assigned', 'returned'] } },
        data: { status: 'pending_assign', purchaserId: null, assignerId: null, assignedAt: null },
      })
      if (changed.count !== 1) throw new ConflictException('预采购单状态已变化，请刷新后再提交')
      return tx.prePurchaseOrder.findUniqueOrThrow({ where: { id: row.id } })
    })

    await this.opLog.log({
      operatorId: viewer?.userId,
      module: 'purchase',
      action: 'resubmit_pre_po',
      targetType: 'pre_purchase_order',
      targetId: updated.prePoNo,
      detail: { poNo: po.poNo, sku: updated.sku },
    })
    const [item] = await this.enrich([updated])
    return item
  }

  /** 已取消、且没有仍存在的采购单时，才能从列表删除。 */
  async removeCancelled(id: number, viewer?: { userId: number; roleCode: string }) {
    const row = await this.prisma.prePurchaseOrder.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('预采购单不存在')
    if (row.status !== 'cancelled') throw new BadRequestException('仅已取消的预采购单可以删除')
    if (viewer?.roleCode === 'purchaser' && row.purchaserId && Number(row.purchaserId) !== viewer.userId) {
      throw new ForbiddenException('无权删除未分配给您的预采购单')
    }
    if (row.convertedPoId) {
      const po = await this.prisma.purchaseOrder.findUnique({ where: { id: row.convertedPoId }, select: { id: true, poNo: true } })
      if (po) throw new BadRequestException(`请先删除关联采购单 ${po.poNo}`)
    }
    await this.prisma.prePurchaseOrder.delete({ where: { id: row.id } })
    await this.opLog.log({
      operatorId: viewer?.userId,
      module: 'purchase',
      action: 'delete',
      targetType: 'pre_purchase_order',
      targetId: row.prePoNo,
      detail: { sku: row.sku },
    })
    return { id }
  }

  /** Active purchasers for assign dialogs; callers gate with purchase.assign / products.edit. */
  async listPurchaserOptions() {
    const rows = await this.prisma.sysUser.findMany({
      where: { roleCode: 'purchaser', status: 1 },
      select: { id: true, username: true, realName: true },
      orderBy: [{ realName: 'asc' }, { username: 'asc' }],
    })
    return {
      items: rows.map((r) => ({
        id: Number(r.id),
        username: r.username,
        realName: r.realName,
        label: r.realName || r.username,
      })),
    }
  }
}
