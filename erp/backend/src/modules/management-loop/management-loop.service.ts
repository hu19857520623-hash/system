import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { InventoryMutationService } from '../../common/inventory/inventory-mutation.service'
import { OperationLogService } from '../operation-log/operation-log.service'
import {
  PRODUCT_DIM_SELECT,
  accumulateChargeAmounts,
  inboundReportQty,
  outboundReportQty,
  sumReportCbm,
  userDisplayName,
} from './management-loop-report.util'
import {
  hasInboundScopeFilter,
  inboundOccurredAtRange,
  parseStocktakeScope,
  stocktakeScopeLabel,
  stocktakeScopeSnapshot,
} from './management-loop-stocktake.util'
import { capacityAlertLevel, summarizeWarehouseCapacity } from './management-loop-capacity.util'

const toNumber = (value: unknown) => Number(value ?? 0)
const round = (value: number, digits = 2) => Number(value.toFixed(digits))
const REPORT_PAGE_SIZE_MAX = 5000

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

function inboundSqlFilters(query: Record<string, unknown>): Prisma.Sql[] {
  const filters: Prisma.Sql[] = []
  const createdAt = dateRange(query as { dateFrom?: string; dateTo?: string })
  if (createdAt?.gte) filters.push(Prisma.sql`o.created_at >= ${createdAt.gte}`)
  if (createdAt?.lte) filters.push(Prisma.sql`o.created_at <= ${createdAt.lte}`)
  if (query.warehouseCode) filters.push(Prisma.sql`o.warehouse_code = ${String(query.warehouseCode)}`)
  if (query.customerCode) filters.push(Prisma.sql`o.oms_customer_code = ${String(query.customerCode)}`)
  if (query.status) filters.push(Prisma.sql`o.status = ${String(query.status)}`)
  return filters
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
    const pageSize = Math.min(REPORT_PAGE_SIZE_MAX, Math.max(1, Number(query.pageSize) || 20))
    const where = buildInboundWhere(query)
    const completedWhere: Prisma.InboundOrderWhereInput = {
      ...where,
      status: { in: ['completed', 'confirmed'] },
    }

    const [rows, total, orderCount, completedCount, statusGroups, itemAgg, cycleRow, feeAmount, volumeItems] =
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
        this.aggregateFeeAmount('inbound_order', inboundSqlFilters(query)),
        this.prisma.inboundOrderItem.findMany({
          where: { order: where },
          select: { inboundId: true, productId: true, expectedQty: true, actualQty: true },
        }),
      ])

    const productIds = [
      ...new Set([
        ...rows.flatMap((row) => row.items.map((item) => item.productId)),
        ...volumeItems.map((item) => item.productId),
      ]),
    ]
    const [productMap, chargeMap, userMap] = await Promise.all([
      this.loadProductDimMap(productIds),
      this.loadChargeMap(rows.map((row) => row.inboundNo)),
      this.loadUserNames(rows.flatMap((row) => [row.receivedBy, row.qcBy])),
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
        cbm: sumReportCbm(
          row.items.map((item) => ({ productId: item.productId, qty: inboundReportQty(item) })),
          productMap,
        ),
        feeAmount: round(chargeMap.get(row.inboundNo) || 0),
        receivedBy: row.receivedBy ? Number(row.receivedBy) : null,
        receivedByName: userMap.get(String(row.receivedBy || '')) || '',
        qcBy: row.qcBy ? Number(row.qcBy) : null,
        qcByName: userMap.get(String(row.qcBy || '')) || '',
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
        cbm: sumReportCbm(
          volumeItems.map((item) => ({ productId: item.productId, qty: inboundReportQty(item) })),
          productMap,
        ),
        feeAmount: round(feeAmount),
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
    const pageSize = Math.min(REPORT_PAGE_SIZE_MAX, Math.max(1, Number(query.pageSize) || 20))
    const where = buildOutboundWhere(query)
    const completedWhere: Prisma.OutboundOrderWhereInput = {
      ...where,
      status: { in: ['shipped', 'delivered'] },
    }

    const [rows, total, orderCount, completedCount, statusGroups, itemAgg, exceptionCount, feeAmount, volumeItems] =
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
        this.aggregateFeeAmount('outbound_order', outboundSqlFilters(query)),
        this.prisma.outboundOrderItem.findMany({
          where: { order: where },
          select: { outboundId: true, productId: true, qty: true, pickedQty: true },
        }),
      ])

    const productIds = [
      ...new Set([
        ...rows.flatMap((row) => row.items.map((item) => item.productId)),
        ...volumeItems.map((item) => item.productId),
      ]),
    ]
    const [productMap, chargeMap, userMap] = await Promise.all([
      this.loadProductDimMap(productIds),
      this.loadChargeMap(rows.map((row) => row.outboundNo)),
      this.loadUserNames(rows.flatMap((row) => [row.pickerId, row.reviewerId])),
    ])

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
        cbm: sumReportCbm(
          row.items.map((item) => ({ productId: item.productId, qty: outboundReportQty(item) })),
          productMap,
        ),
        feeAmount: round(chargeMap.get(row.outboundNo) || 0),
        pickerId: row.pickerId ? Number(row.pickerId) : null,
        pickerName: userMap.get(String(row.pickerId || '')) || '',
        reviewerId: row.reviewerId ? Number(row.reviewerId) : null,
        reviewerName: userMap.get(String(row.reviewerId || '')) || '',
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
        cbm: sumReportCbm(
          volumeItems.map((item) => ({ productId: item.productId, qty: outboundReportQty(item) })),
          productMap,
        ),
        feeAmount: round(feeAmount),
      },
    }
  }

  private async aggregateFeeAmount(
    orderTable: 'inbound_order' | 'outbound_order',
    filters: Prisma.Sql[],
  ) {
    const where = sqlWhere([...filters, Prisma.sql`c.status <> 'cancelled'`])
    const rows = orderTable === 'inbound_order'
      ? await this.prisma.$queryRaw<Array<{ feeAmount: unknown }>>`
          SELECT COALESCE(SUM(c.amount), 0) AS feeAmount
          FROM billing_charge c
          INNER JOIN inbound_order o ON c.biz_ref = o.inbound_no
          ${where}
        `
      : await this.prisma.$queryRaw<Array<{ feeAmount: unknown }>>`
          SELECT COALESCE(SUM(c.amount), 0) AS feeAmount
          FROM billing_charge c
          INNER JOIN outbound_order o ON c.biz_ref = o.outbound_no
          ${where}
        `
    return toNumber(rows[0]?.feeAmount)
  }

  private async loadProductDimMap(productIds: bigint[]) {
    const unique = [...new Set(productIds)]
    if (!unique.length) return new Map()
    const products = await this.prisma.product.findMany({
      where: { id: { in: unique } },
      select: PRODUCT_DIM_SELECT,
    })
    return new Map(products.map((product) => [String(product.id), product]))
  }

  private async loadChargeMap(refs: string[]) {
    if (!refs.length) return new Map<string, number>()
    const charges = await this.prisma.billingCharge.findMany({
      where: { bizRef: { in: refs }, status: { not: 'cancelled' } },
      select: { bizRef: true, amount: true, status: true },
    })
    return accumulateChargeAmounts(charges)
  }

  private async loadUserNames(ids: Array<bigint | null | undefined>) {
    const unique = [...new Set(ids.filter((id): id is bigint => id != null))]
    if (!unique.length) return new Map<string, string>()
    const users = await this.prisma.sysUser.findMany({
      where: { id: { in: unique } },
      select: { id: true, realName: true, username: true },
    })
    return new Map(users.map((user) => [String(user.id), userDisplayName(user)]))
  }

  async listStocktakes(query: any) {
    const where: Prisma.StocktakePlanWhereInput = {}
    if (query.warehouseCode) where.warehouseCode = String(query.warehouseCode)
    if (query.status) where.status = String(query.status)
    if (query.stocktakeNo) where.stocktakeNo = String(query.stocktakeNo).trim()
    const rows = await this.prisma.stocktakePlan.findMany({ where, include: { _count: { select: { lines: true } } }, orderBy: { id: 'desc' } })
    return rows.map((row) => {
      const scope = (row.scopeJson || {}) as Record<string, unknown>
      return {
        ...row,
        id: Number(row.id),
        lineCount: row._count.lines,
        scope,
        scopeLabel: stocktakeScopeLabel(scope as any),
      }
    })
  }

  async stocktakeOptions(warehouseCode?: string) {
    const where: Prisma.InboundOrderWhereInput = {
      omsCustomerCode: { not: null },
    }
    if (warehouseCode) where.warehouseCode = warehouseCode
    const rows = await this.prisma.inboundOrder.findMany({
      where,
      distinct: ['omsCustomerCode'],
      select: { omsCustomerCode: true },
      orderBy: { omsCustomerCode: 'asc' },
      take: 400,
    })
    return {
      customers: rows
        .map((row) => String(row.omsCustomerCode || '').trim())
        .filter(Boolean)
        .map((customerCode) => ({ customerCode })),
    }
  }

  async stocktakeDetail(id: number) {
    const plan = await this.prisma.stocktakePlan.findUnique({ where: { id: BigInt(id) }, include: { lines: { orderBy: [{ locationCode: 'asc' }, { sku: 'asc' }] } } })
    if (!plan) throw new NotFoundException('盘点单不存在')
    const hideBookQty = plan.blindCount && plan.status === 'counting'
    const scope = (plan.scopeJson || {}) as Record<string, unknown>
    return {
      ...plan,
      id: Number(plan.id),
      scope,
      scopeLabel: stocktakeScopeLabel(scope as any),
      lines: plan.lines.map((line) => ({
        ...line,
        bookQty: hideBookQty ? null : line.bookQty,
        id: Number(line.id),
        planId: Number(line.planId),
        productId: Number(line.productId),
        locationId: Number(line.locationId),
      })),
    }
  }

  async createStocktake(body: any, userId?: number) {
    const scope = parseStocktakeScope(body)
    if (!scope.warehouseCode) throw new BadRequestException('请选择仓库')
    if (scope.mode === 'location' && !scope.locationIds.length) {
      throw new BadRequestException('库位盘点至少选择一个库位')
    }
    if (scope.mode === 'sku' && !scope.skus.length) {
      throw new BadRequestException('指定 SKU 盘点至少填写一个 SKU')
    }
    const where: Prisma.InventoryLocationWhereInput = { warehouseCode: scope.warehouseCode, qty: { gt: 0 } }
    if (scope.locationIds.length) where.locationId = { in: scope.locationIds.map((id) => BigInt(id)) }
    if (scope.skus.length) where.sku = { in: scope.skus }
    if (hasInboundScopeFilter(scope)) {
      const inboundNos = await this.resolveStocktakeInboundNos(scope)
      if (!inboundNos.length) throw new BadRequestException('所选客户/入库范围没有可盘库存')
      where.inboundNo = { in: inboundNos }
    }
    let inventory = (await this.prisma.inventoryLocation.groupBy({
      by: ['productId', 'sku', 'locationId', 'locationCode'], where,
      _sum: { qty: true }, orderBy: [{ locationCode: 'asc' }, { sku: 'asc' }],
    })).map((item) => ({ ...item, qty: item._sum.qty ?? 0 }))
    if (scope.mode === 'spot') {
      const size = Math.max(1, Math.min(inventory.length, scope.sampleSize))
      inventory = inventory.sort(() => Math.random() - 0.5).slice(0, size)
    }
    if (!inventory.length) throw new BadRequestException('所选范围没有可盘库存')
    const stocktakeNo = `PD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Date.now()).slice(-6)}`
    const plan = await this.prisma.stocktakePlan.create({ data: {
      stocktakeNo, warehouseCode: scope.warehouseCode, mode: scope.mode, blindCount: body.blindCount !== false,
      status: 'counting', scopeJson: stocktakeScopeSnapshot(scope),
      remark: body.remark || null, createdBy: userId ? BigInt(userId) : null, startedAt: new Date(),
      lines: { create: inventory.map((item) => ({ productId: item.productId, sku: item.sku, locationId: item.locationId, locationCode: item.locationCode, bookQty: item.qty })) },
    }})
    await this.opLog.log({
      operatorId: userId, module: 'stocktake', action: 'create', targetType: 'stocktake_plan', targetId: stocktakeNo,
      detail: { mode: scope.mode, warehouseCode: scope.warehouseCode, customerCode: scope.customerCode || null, inboundNo: scope.inboundNo || null, lineCount: inventory.length },
    })
    return this.stocktakeDetail(Number(plan.id))
  }

  private async resolveStocktakeInboundNos(scope: ReturnType<typeof parseStocktakeScope>) {
    const occurredAt = inboundOccurredAtRange(scope.inboundDateFrom, scope.inboundDateTo)
    const where: Prisma.InboundOrderWhereInput = { warehouseCode: scope.warehouseCode }
    if (scope.inboundNo) where.inboundNo = scope.inboundNo
    if (scope.customerCode) where.omsCustomerCode = scope.customerCode
    if (occurredAt) {
      where.OR = [
        { putawayAt: occurredAt },
        { AND: [{ putawayAt: null }, { receivedAt: occurredAt }] },
        { AND: [{ putawayAt: null }, { receivedAt: null }, { createdAt: occurredAt }] },
      ]
    }
    const rows = await this.prisma.inboundOrder.findMany({ where, select: { inboundNo: true } })
    return [...new Set(rows.map((row) => row.inboundNo))]
  }

  async submitCount(planId: number, body: any, userId?: number) {
    const plan = await this.prisma.stocktakePlan.findUnique({ where: { id: BigInt(planId) } })
    if (!plan) throw new NotFoundException('盘点单不存在')
    if (plan.status !== 'counting') throw new BadRequestException('盘点单已结束，不能继续录入')
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
    const pendingProductIds = [...new Set(pending.flatMap((order) => order.items.map((item) => item.productId)))]
    const pendingProducts = pendingProductIds.length ? await this.prisma.product.findMany({
      where: { id: { in: pendingProductIds } },
      select: { id: true, lengthCm: true, widthCm: true, heightCm: true, measuredLengthCm: true, measuredWidthCm: true, measuredHeightCm: true },
    }) : []
    const pendingProductMap = new Map(pendingProducts.map((product) => [String(product.id), product]))
    const pendingByWarehouse = new Map<string, { qty: number; volumeCbm: number }>()
    for (const order of pending) {
      const bucket = pendingByWarehouse.get(order.warehouseCode) || { qty: 0, volumeCbm: 0 }
      for (const item of order.items) {
        const qty = Math.max(0, item.expectedQty - (item.putawayQty ?? 0))
        bucket.qty += qty
        const product = pendingProductMap.get(String(item.productId))
        const length = toNumber(product?.measuredLengthCm ?? product?.lengthCm)
        const width = toNumber(product?.measuredWidthCm ?? product?.widthCm)
        const height = toNumber(product?.measuredHeightCm ?? product?.heightCm)
        if (length > 0 && width > 0 && height > 0) bucket.volumeCbm += length * width * height / 1000000 * qty
      }
      pendingByWarehouse.set(order.warehouseCode, bucket)
    }
    const locationCodes = [...new Set(items.map((item) => item.warehouseCode))]
    const warehouseWhere: Prisma.WarehouseWhereInput = warehouseCode
      ? { warehouseCode }
      : locationCodes.length ? { warehouseCode: { in: locationCodes } } : { warehouseType: 'wms' }
    const warehouseRows = await this.prisma.warehouse.findMany({ where: warehouseWhere, orderBy: { id: 'asc' } })
    const warehouses = warehouseRows.map((warehouse) => {
      const locItems = items.filter((item) => item.warehouseCode === warehouse.warehouseCode)
      const pendingBucket = pendingByWarehouse.get(warehouse.warehouseCode) || { qty: 0, volumeCbm: 0 }
      return {
        id: warehouse.id,
        ...summarizeWarehouseCapacity({
          warehouseCode: warehouse.warehouseCode,
          warehouseName: warehouse.warehouseName,
          totalVolumeCbm: warehouse.totalVolumeCbm,
          usedVolumeCbm: locItems.reduce((sum, item) => sum + item.usedVolumeCbm, 0),
          pendingVolumeCbm: pendingBucket.volumeCbm,
          locationCount: locItems.length,
          locationMaxVolumeCbm: locItems.reduce((sum, item) => sum + item.maxVolumeCbm, 0),
          unknownDimensionQty: locItems.reduce((sum, item) => sum + item.unknownDimensionQty, 0),
        }),
      }
    })
    const pendingQty = [...pendingByWarehouse.values()].reduce((sum, bucket) => sum + bucket.qty, 0)
    const pendingVolumeCbm = [...pendingByWarehouse.values()].reduce((sum, bucket) => sum + bucket.volumeCbm, 0)
    const totalUsedVolume = warehouses.reduce((sum, row) => sum + row.usedVolumeCbm, 0)
    const warehouseCap = warehouses.reduce((sum, row) => sum + row.totalVolumeCbm, 0)
    const locationMaxVolume = items.reduce((sum, item) => sum + item.maxVolumeCbm, 0)
    const summarySource = warehouses.length === 1 ? warehouses[0] : summarizeWarehouseCapacity({
      warehouseCode: warehouseCode || 'ALL',
      warehouseName: '全部仓库',
      totalVolumeCbm: warehouseCap,
      usedVolumeCbm: totalUsedVolume,
      pendingVolumeCbm,
      locationCount: items.length,
      locationMaxVolumeCbm: locationMaxVolume,
      unknownDimensionQty: items.reduce((sum, item) => sum + item.unknownDimensionQty, 0),
    })
    return {
      items,
      warehouses,
      summary: {
        locationCount: items.length,
        warningCount: items.filter((item) => item.alertLevel !== 'normal').length
          + warehouses.filter((row) => row.alertLevel !== 'normal').length,
        unknownDimensionQty: summarySource.unknownDimensionQty,
        pendingInboundQty: pendingQty,
        pendingVolumeCbm: round(pendingVolumeCbm, 4),
        projectedVolumeCbm: summarySource.projectedVolumeCbm,
        projectedRate: summarySource.projectedRate,
        usageRate: summarySource.usageRate,
        maxVolumeCbm: summarySource.totalVolumeCbm,
        usedVolumeCbm: round(totalUsedVolume, 4),
        locationMaxVolumeCbm: round(locationMaxVolume, 4),
        capacitySet: summarySource.capacitySet,
        capacitySource: summarySource.capacitySet ? 'warehouse' : 'unset',
        alertLevel: summarySource.alertLevel,
      },
    }
  }

  async refreshCapacityAlerts(warehouseCode?: string) {
    const overview = await this.capacityOverview(warehouseCode)
    const codes = [...new Set([
      ...overview.warehouses.map((row) => row.warehouseCode),
      ...overview.items.map((item) => item.warehouseCode),
    ])].filter((code) => code && code !== 'ALL')
    if (codes.length) await this.prisma.capacityAlert.updateMany({ where: { warehouseCode: { in: codes }, status: 'open' }, data: { status: 'resolved', resolvedAt: new Date() } })
    const alerts = overview.items.filter((item) => item.alertLevel !== 'normal' || item.unknownDimensionQty > 0)
    const alertRows: any[] = alerts.map((item) => ({
      warehouseCode: item.warehouseCode, locationId: BigInt(item.id), locationCode: item.locationCode,
      alertType: item.unknownDimensionQty > 0 ? 'missing_dimensions' : 'capacity', alertLevel: item.unknownDimensionQty > 0 ? 'warning' : item.alertLevel,
      usageRate: item.usageRate / 100, message: item.unknownDimensionQty > 0 ? `${item.locationCode} 有 ${item.unknownDimensionQty} 件商品缺少尺寸` : `${item.locationCode} 容量使用率 ${item.usageRate}%`,
    }))
    for (const warehouse of overview.warehouses) {
      if (!warehouse.capacitySet) continue
      if (warehouse.usageRate >= 80) {
        alertRows.push({
          warehouseCode: warehouse.warehouseCode, locationId: null, locationCode: null, alertType: 'capacity',
          alertLevel: capacityAlertLevel(warehouse.usageRate / 100),
          usageRate: warehouse.usageRate / 100,
          message: `${warehouse.warehouseName} 仓级容量使用率 ${warehouse.usageRate}%（上限 ${warehouse.totalVolumeCbm} m³）`,
        })
      }
      if (warehouse.projectedRate >= 80 && warehouse.pendingVolumeCbm > 0) {
        alertRows.push({
          warehouseCode: warehouse.warehouseCode, locationId: null, locationCode: null, alertType: 'projected_capacity',
          alertLevel: capacityAlertLevel(warehouse.projectedRate / 100),
          usageRate: warehouse.projectedRate / 100,
          message: `计入待入库后，${warehouse.warehouseName} 预计仓级容量使用率 ${warehouse.projectedRate}%（上限 ${warehouse.totalVolumeCbm} m³）`,
        })
      }
    }
    if (alertRows.length) await this.prisma.capacityAlert.createMany({ data: alertRows })
    return { refreshed: alertRows.length, alerts: alertRows }
  }
}
