import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { InventoryMutationService } from '../../common/inventory/inventory-mutation.service'
import { OperationLogService } from '../operation-log/operation-log.service'

const toNumber = (value: unknown) => Number(value ?? 0)
const round = (value: number, digits = 2) => Number(value.toFixed(digits))

function dateRange(query: { dateFrom?: string; dateTo?: string }) {
  const createdAt: { gte?: Date; lte?: Date } = {}
  if (query.dateFrom) createdAt.gte = new Date(`${query.dateFrom}T00:00:00+08:00`)
  if (query.dateTo) createdAt.lte = new Date(`${query.dateTo}T23:59:59.999+08:00`)
  return Object.keys(createdAt).length ? createdAt : undefined
}

function buildInboundWhere(query: Record<string, unknown>): Prisma.InboundOrderWhereInput {
  const where: Prisma.InboundOrderWhereInput = {}
  const createdAt = dateRange(query as { dateFrom?: string; dateTo?: string })
  if (createdAt) where.createdAt = createdAt
  if (query.warehouseCode) where.warehouseCode = String(query.warehouseCode)
  if (query.customerCode) where.omsCustomerCode = String(query.customerCode)
  if (query.status) where.status = String(query.status)
  return where
}

function buildOutboundWhere(query: Record<string, unknown>): Prisma.OutboundOrderWhereInput {
  const where: Prisma.OutboundOrderWhereInput = {}
  const createdAt = dateRange(query as { dateFrom?: string; dateTo?: string })
  if (createdAt) where.createdAt = createdAt
  if (query.warehouseCode) where.warehouseCode = String(query.warehouseCode)
  if (query.customerId) where.customerId = BigInt(String(query.customerId))
  if (query.status) where.status = String(query.status)
  return where
}

function outboundSqlFilters(query: Record<string, unknown>): Prisma.Sql[] {
  const filters: Prisma.Sql[] = []
  const createdAt = dateRange(query as { dateFrom?: string; dateTo?: string })
  if (createdAt?.gte) filters.push(Prisma.sql`o.created_at >= ${createdAt.gte}`)
  if (createdAt?.lte) filters.push(Prisma.sql`o.created_at <= ${createdAt.lte}`)
  if (query.warehouseCode) filters.push(Prisma.sql`o.warehouse_code = ${String(query.warehouseCode)}`)
  if (query.customerId) filters.push(Prisma.sql`o.customer_id = ${BigInt(String(query.customerId))}`)
  if (query.status) filters.push(Prisma.sql`o.status = ${String(query.status)}`)
  return filters
}

function sqlWhere(filters: Prisma.Sql[]) {
  return filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty
}

@Injectable()
export class ManagementLoopService {
  constructor(
    private prisma: PrismaService,
    private opLog: OperationLogService,
    private inventoryMutation: InventoryMutationService,
  ) {}

  async reportSummary(query: any) {
    const inbound = await this.inboundReport({ ...query, page: 1, pageSize: 1 })
    const outbound = await this.outboundReport({ ...query, page: 1, pageSize: 1 })
    return { inbound: inbound.summary, outbound: outbound.summary, generatedAt: new Date() }
  }

  async inboundReport(query: any) {
    const page = Math.max(1, Number(query.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20))
    const where = buildInboundWhere(query)
    const completedWhere: Prisma.InboundOrderWhereInput = {
      ...where,
      status: { in: ['completed', 'confirmed'] },
    }

    const [rows, total, orderCount, completedCount, statusGroups, itemAgg, cycleRow] =
      await Promise.all([
        this.prisma.inboundOrder.findMany({
          where,
          include: { items: true, cartons: true },
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.inboundOrder.count({ where }),
        this.prisma.inboundOrder.count({ where }),
        this.prisma.inboundOrder.count({ where: completedWhere }),
        this.prisma.inboundOrder.groupBy({ by: ['status'], where, _count: { _all: true } }),
        this.prisma.inboundOrderItem.aggregate({
          where: { order: where },
          _sum: { expectedQty: true, actualQty: true },
        }),
        this.aggregateInboundCycleHours(completedWhere),
      ])

    const totalExpectedQty = itemAgg._sum.expectedQty ?? 0
    const totalReceivedQty = itemAgg._sum.actualQty ?? 0
    const statusCounts = statusGroups.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row._count._all
      return acc
    }, {})

    return {
      items: rows.map((row) => ({
        id: Number(row.id), inboundNo: row.inboundNo, warehouseCode: row.warehouseCode,
        customerCode: row.omsCustomerCode, status: row.status, createdAt: row.createdAt,
        arrivedAt: row.arrivedAt, receivedAt: row.receivedAt, putawayAt: row.putawayAt,
        expectedQty: row.items.reduce((s, item) => s + item.expectedQty, 0),
        receivedQty: row.items.reduce((s, item) => s + (item.actualQty ?? 0), 0),
        putawayQty: row.items.reduce((s, item) => s + (item.putawayQty ?? 0), 0),
        cartonCount: row.receivedCartonCount ?? row.cartons.filter((carton) => carton.status === 'received').length,
      })),
      total, page, pageSize,
      summary: {
        orderCount,
        completedCount,
        statusCounts,
        expectedQty: totalExpectedQty,
        receivedQty: totalReceivedQty,
        varianceQty: totalReceivedQty - totalExpectedQty,
        completionRate: orderCount ? round(completedCount / orderCount * 100, 1) : 0,
        avgCycleHours: cycleRow,
      },
    }
  }

  private async aggregateInboundCycleHours(where: Prisma.InboundOrderWhereInput) {
    const orders = await this.prisma.inboundOrder.findMany({
      where: {
        ...where,
        arrivedAt: { not: null },
        putawayAt: { not: null },
      },
      select: { arrivedAt: true, putawayAt: true },
    })
    if (!orders.length) return 0
    const hours = orders.map((row) => (row.putawayAt!.getTime() - row.arrivedAt!.getTime()) / 3600000)
    return round(hours.reduce((a, b) => a + b, 0) / hours.length, 1)
  }

  async outboundReport(query: any) {
    const page = Math.max(1, Number(query.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20))
    const where = buildOutboundWhere(query)
    const completedWhere: Prisma.OutboundOrderWhereInput = {
      ...where,
      status: { in: ['shipped', 'delivered'] },
    }

    const [rows, total, orderCount, completedCount, statusGroups, itemAgg, exceptionCount, feeAmount] =
      await Promise.all([
        this.prisma.outboundOrder.findMany({
          where,
          include: { items: true },
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.outboundOrder.count({ where }),
        this.prisma.outboundOrder.count({ where }),
        this.prisma.outboundOrder.count({ where: completedWhere }),
        this.prisma.outboundOrder.groupBy({ by: ['status'], where, _count: { _all: true } }),
        this.prisma.outboundOrderItem.aggregate({
          where: { order: where },
          _sum: { qty: true, pickedQty: true },
        }),
        this.prisma.outboundOrder.count({
          where: {
            ...where,
            OR: [{ isProblem: true }, { exceptionType: { not: null } }],
          },
        }),
        this.aggregateOutboundFeeAmount(query),
      ])

    const pageRefs = rows.map((row) => row.outboundNo)
    const charges = pageRefs.length
      ? await this.prisma.billingCharge.findMany({
          where: { bizRef: { in: pageRefs } },
          select: { bizRef: true, amount: true },
        })
      : []
    const chargeMap = new Map<string, number>()
    charges.forEach((charge) =>
      chargeMap.set(charge.bizRef || '', (chargeMap.get(charge.bizRef || '') || 0) + toNumber(charge.amount)),
    )

    const requestedQty = itemAgg._sum.qty ?? 0
    const pickedQty = itemAgg._sum.pickedQty ?? 0
    const statusCounts = statusGroups.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row._count._all
      return acc
    }, {})

    return {
      items: rows.map((row) => ({
        id: Number(row.id), outboundNo: row.outboundNo, warehouseCode: row.warehouseCode,
        customerId: row.customerId ? Number(row.customerId) : null, status: row.status,
        carrier: row.carrier, createdAt: row.createdAt, pickedAt: row.pickedAt, shippedAt: row.shippedAt,
        qty: row.items.reduce((s, item) => s + item.qty, 0),
        pickedQty: row.items.reduce((s, item) => s + item.pickedQty, 0),
        exceptionType: row.exceptionType || row.problemType,
        feeAmount: round(chargeMap.get(row.outboundNo) || 0),
      })),
      total, page, pageSize,
      summary: {
        orderCount,
        completedCount,
        statusCounts,
        requestedQty,
        pickedQty,
        shortageQty: Math.max(0, requestedQty - pickedQty),
        fulfillmentRate: orderCount ? round(completedCount / orderCount * 100, 1) : 0,
        exceptionCount,
        feeAmount: round(feeAmount),
      },
    }
  }

  private async aggregateOutboundFeeAmount(query: Record<string, unknown>) {
    const filters = outboundSqlFilters(query)
    const rows = await this.prisma.$queryRaw<Array<{ feeAmount: unknown }>>`
      SELECT COALESCE(SUM(c.amount), 0) AS feeAmount
      FROM billing_charge c
      INNER JOIN outbound_order o ON c.biz_ref = o.outbound_no
      ${sqlWhere(filters)}
    `
    return toNumber(rows[0]?.feeAmount)
  }

  async listStocktakes(query: any) {
    const where: any = {}
    if (query.warehouseCode) where.warehouseCode = query.warehouseCode
    if (query.status) where.status = query.status
    const rows = await this.prisma.stocktakePlan.findMany({ where, include: { _count: { select: { lines: true } } }, orderBy: { id: 'desc' } })
    return rows.map((row) => ({ ...row, id: Number(row.id), lineCount: row._count.lines }))
  }

  async stocktakeDetail(id: number) {
    const plan = await this.prisma.stocktakePlan.findUnique({ where: { id: BigInt(id) }, include: { lines: { orderBy: [{ locationCode: 'asc' }, { sku: 'asc' }] } } })
    if (!plan) throw new NotFoundException('盘点单不存在')
    const hideBookQty = plan.blindCount && plan.status === 'counting'
    return { ...plan, id: Number(plan.id), lines: plan.lines.map((line) => ({ ...line, bookQty: hideBookQty ? null : line.bookQty, id: Number(line.id), planId: Number(line.planId), productId: Number(line.productId), locationId: Number(line.locationId) })) }
  }

  async createStocktake(body: any, userId?: number) {
    const warehouseCode = String(body.warehouseCode || '').trim()
    if (!warehouseCode) throw new BadRequestException('请选择仓库')
    const mode = String(body.mode || 'location')
    if (mode === 'location' && (!Array.isArray(body.locationIds) || !body.locationIds.length)) {
      throw new BadRequestException('库位盘点至少选择一个库位')
    }
    if (mode === 'sku' && (!Array.isArray(body.skus) || !body.skus.length)) {
      throw new BadRequestException('指定 SKU 盘点至少填写一个 SKU')
    }
    const where: any = { warehouseCode, qty: { gt: 0 } }
    if (Array.isArray(body.locationIds) && body.locationIds.length) where.locationId = { in: body.locationIds.map((id: any) => BigInt(id)) }
    if (Array.isArray(body.skus) && body.skus.length) where.sku = { in: body.skus.map(String) }
    let inventory = (await this.prisma.inventoryLocation.groupBy({
      by: ['productId', 'sku', 'locationId', 'locationCode'], where,
      _sum: { qty: true }, orderBy: [{ locationCode: 'asc' }, { sku: 'asc' }],
    })).map((item) => ({ ...item, qty: item._sum.qty ?? 0 }))
    if (mode === 'spot') {
      const size = Math.max(1, Math.min(inventory.length, Number(body.sampleSize) || 20))
      inventory = inventory.sort(() => Math.random() - 0.5).slice(0, size)
    }
    if (!inventory.length) throw new BadRequestException('所选范围没有可盘库存')
    const stocktakeNo = `PD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Date.now()).slice(-6)}`
    const plan = await this.prisma.stocktakePlan.create({ data: {
      stocktakeNo, warehouseCode, mode, blindCount: body.blindCount !== false,
      status: 'counting', scopeJson: { locationIds: body.locationIds || [], skus: body.skus || [], sampleSize: body.sampleSize || null },
      remark: body.remark || null, createdBy: userId ? BigInt(userId) : null, startedAt: new Date(),
      lines: { create: inventory.map((item) => ({ productId: item.productId, sku: item.sku, locationId: item.locationId, locationCode: item.locationCode, bookQty: item.qty })) },
    }})
    await this.opLog.log({ operatorId: userId, module: 'stocktake', action: 'create', targetType: 'stocktake_plan', targetId: stocktakeNo, detail: { mode, warehouseCode, lineCount: inventory.length } })
    return this.stocktakeDetail(Number(plan.id))
  }

  async submitCount(planId: number, body: any, userId?: number) {
    const line = await this.prisma.stocktakeLine.findFirst({ where: {
      planId: BigInt(planId),
      ...(body.lineId ? { id: BigInt(body.lineId) } : { sku: String(body.sku || ''), locationCode: String(body.locationCode || '') }),
    }})
    if (!line) throw new NotFoundException('盘点明细不存在')
    const qty = Number(body.qty)
    if (!Number.isInteger(qty) || qty < 0) throw new BadRequestException('实盘数量必须为非负整数')
    const isRecount = line.firstQty != null
    const finalQty = isRecount ? qty : (qty === line.bookQty ? qty : null)
    await this.prisma.stocktakeLine.update({ where: { id: line.id }, data: isRecount ? {
      secondQty: qty, finalQty: qty, varianceQty: qty - line.bookQty, status: qty === line.bookQty ? 'matched' : 'variance',
      secondCountedBy: userId ? BigInt(userId) : null, recountedAt: new Date(),
    } : {
      firstQty: qty, finalQty, varianceQty: finalQty == null ? null : finalQty - line.bookQty,
      status: finalQty == null ? 'recount' : 'matched', firstCountedBy: userId ? BigInt(userId) : null, countedAt: new Date(),
    }})
    const pending = await this.prisma.stocktakeLine.count({ where: { planId: BigInt(planId), status: { in: ['pending', 'recount'] } } })
    if (!pending) await this.prisma.stocktakePlan.update({ where: { id: BigInt(planId) }, data: { status: 'pending_approval' } })
    return this.stocktakeDetail(planId)
  }

  async approveStocktake(id: number, userId?: number) {
    const plan = await this.prisma.stocktakePlan.findUnique({ where: { id: BigInt(id) }, include: { lines: true } })
    if (!plan) throw new NotFoundException('盘点单不存在')
    if (plan.status !== 'pending_approval') throw new BadRequestException('盘点尚未完成，不能审批')
    await this.prisma.$transaction(async (tx) => {
      for (const line of plan.lines) {
        const finalQty = line.finalQty
        if (finalQty == null) throw new BadRequestException(`${line.sku} 尚未完成盘点`)
        await this.inventoryMutation.adjustLocationToTarget(tx, {
          productId: line.productId,
          sku: line.sku,
          warehouseCode: plan.warehouseCode,
          locationId: line.locationId,
          locationCode: line.locationCode,
          targetQty: finalQty,
          operatorId: userId,
          referenceNo: plan.stocktakeNo,
        })
      }
      await tx.stocktakePlan.update({ where: { id: BigInt(id) }, data: { status: 'completed', approvedBy: userId ? BigInt(userId) : null, completedAt: new Date() } })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    await this.opLog.log({ operatorId: userId, module: 'stocktake', action: 'approve', targetType: 'stocktake_plan', targetId: plan.stocktakeNo, detail: { lineCount: plan.lines.length } })
    return this.stocktakeDetail(id)
  }

  async capacityOverview(warehouseCode?: string) {
    const where: any = warehouseCode ? { warehouseCode } : {}
    const locations = await this.prisma.warehouseLocation.findMany({
      where, include: { zone: { select: { zoneCode: true, zoneName: true } }, inventoryItems: { where: { qty: { gt: 0 } } } },
      orderBy: [{ warehouseCode: 'asc' }, { locationCode: 'asc' }],
    })
    const productIds = [...new Set(locations.flatMap((loc) => loc.inventoryItems.map((item) => item.productId)))]
    const products = productIds.length ? await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true, lengthCm: true, widthCm: true, heightCm: true, measuredLengthCm: true, measuredWidthCm: true, measuredHeightCm: true, weightKg: true } }) : []
    const productMap = new Map(products.map((product) => [String(product.id), product]))
    const items = locations.map((loc) => {
      let usedVolumeCbm = 0
      let usedWeightKg = 0
      let unknownDimensionQty = 0
      for (const inventory of loc.inventoryItems) {
        const product = productMap.get(String(inventory.productId))
        const length = toNumber(product?.measuredLengthCm ?? product?.lengthCm)
        const width = toNumber(product?.measuredWidthCm ?? product?.widthCm)
        const height = toNumber(product?.measuredHeightCm ?? product?.heightCm)
        if (length > 0 && width > 0 && height > 0) usedVolumeCbm += length * width * height / 1000000 * inventory.qty
        else unknownDimensionQty += inventory.qty
        usedWeightKg += toNumber(product?.weightKg) * inventory.qty
      }
      const maxVolume = toNumber(loc.maxVolumeCbm)
      const maxWeight = toNumber(loc.maxWeightKg)
      const volumeRate = maxVolume > 0 ? usedVolumeCbm / maxVolume : 0
      const weightRate = maxWeight > 0 ? usedWeightKg / maxWeight : 0
      const usageRate = Math.max(volumeRate, weightRate)
      return {
        id: Number(loc.id), warehouseCode: loc.warehouseCode, zoneCode: loc.zone.zoneCode, zoneName: loc.zone.zoneName,
        locationCode: loc.locationCode, maxVolumeCbm: maxVolume, usedVolumeCbm: round(usedVolumeCbm, 4),
        maxWeightKg: maxWeight, usedWeightKg: round(usedWeightKg, 2), volumeRate: round(volumeRate * 100, 1),
        weightRate: round(weightRate * 100, 1), usageRate: round(usageRate * 100, 1), unknownDimensionQty,
        alertLevel: usageRate >= 0.95 ? 'critical' : usageRate >= 0.9 ? 'high' : usageRate >= 0.8 ? 'warning' : 'normal',
      }
    })
    const pendingWhere: any = { status: { notIn: ['completed', 'confirmed', 'cancelled'] } }
    if (warehouseCode) pendingWhere.warehouseCode = warehouseCode
    const pending = await this.prisma.inboundOrder.findMany({ where: pendingWhere, include: { items: true } })
    const pendingQty = pending.reduce((sum, order) => sum + order.items.reduce((s, item) => s + Math.max(0, item.expectedQty - (item.putawayQty ?? 0)), 0), 0)
    const pendingProductIds = [...new Set(pending.flatMap((order) => order.items.map((item) => item.productId)))]
    const pendingProducts = pendingProductIds.length ? await this.prisma.product.findMany({
      where: { id: { in: pendingProductIds } },
      select: { id: true, lengthCm: true, widthCm: true, heightCm: true, measuredLengthCm: true, measuredWidthCm: true, measuredHeightCm: true },
    }) : []
    const pendingProductMap = new Map(pendingProducts.map((product) => [String(product.id), product]))
    let pendingVolumeCbm = 0
    for (const order of pending) {
      for (const item of order.items) {
        const qty = Math.max(0, item.expectedQty - (item.putawayQty ?? 0))
        const product = pendingProductMap.get(String(item.productId))
        const length = toNumber(product?.measuredLengthCm ?? product?.lengthCm)
        const width = toNumber(product?.measuredWidthCm ?? product?.widthCm)
        const height = toNumber(product?.measuredHeightCm ?? product?.heightCm)
        if (length > 0 && width > 0 && height > 0) pendingVolumeCbm += length * width * height / 1000000 * qty
      }
    }
    const totalMaxVolume = items.reduce((s, item) => s + item.maxVolumeCbm, 0)
    const totalUsedVolume = items.reduce((s, item) => s + item.usedVolumeCbm, 0)
    return {
      items,
      summary: {
        locationCount: items.length, warningCount: items.filter((item) => item.alertLevel !== 'normal').length,
        unknownDimensionQty: items.reduce((s, item) => s + item.unknownDimensionQty, 0), pendingInboundQty: pendingQty,
        pendingVolumeCbm: round(pendingVolumeCbm, 4), projectedVolumeCbm: round(totalUsedVolume + pendingVolumeCbm, 4),
        projectedRate: totalMaxVolume > 0 ? round((totalUsedVolume + pendingVolumeCbm) / totalMaxVolume * 100, 1) : 0,
        maxVolumeCbm: round(totalMaxVolume, 4), usedVolumeCbm: round(totalUsedVolume, 4),
      },
    }
  }

  async refreshCapacityAlerts(warehouseCode?: string) {
    const overview = await this.capacityOverview(warehouseCode)
    const codes = [...new Set(overview.items.map((item) => item.warehouseCode))]
    if (codes.length) await this.prisma.capacityAlert.updateMany({ where: { warehouseCode: { in: codes }, status: 'open' }, data: { status: 'resolved', resolvedAt: new Date() } })
    const alerts = overview.items.filter((item) => item.alertLevel !== 'normal' || item.unknownDimensionQty > 0)
    const alertRows: any[] = alerts.map((item) => ({
      warehouseCode: item.warehouseCode, locationId: BigInt(item.id), locationCode: item.locationCode,
      alertType: item.unknownDimensionQty > 0 ? 'missing_dimensions' : 'capacity', alertLevel: item.unknownDimensionQty > 0 ? 'warning' : item.alertLevel,
      usageRate: item.usageRate / 100, message: item.unknownDimensionQty > 0 ? `${item.locationCode} 有 ${item.unknownDimensionQty} 件商品缺少尺寸` : `${item.locationCode} 容量使用率 ${item.usageRate}%`,
    }))
    if (overview.summary.projectedRate >= 80 && codes.length === 1) {
      alertRows.push({
        warehouseCode: codes[0], locationId: null, locationCode: null, alertType: 'projected_capacity',
        alertLevel: overview.summary.projectedRate >= 95 ? 'critical' : overview.summary.projectedRate >= 90 ? 'high' : 'warning',
        usageRate: overview.summary.projectedRate / 100,
        message: `计入待入库后，仓库预计容量使用率 ${overview.summary.projectedRate}%`,
      })
    }
    if (alertRows.length) await this.prisma.capacityAlert.createMany({ data: alertRows })
    return { refreshed: alertRows.length, alerts: alertRows }
  }
}
