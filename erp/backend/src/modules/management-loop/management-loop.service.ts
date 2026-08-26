import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { OperationLogService } from '../operation-log/operation-log.service'
import { BillingService } from '../billing/billing.service'

const toNumber = (value: unknown) => Number(value ?? 0)
const round = (value: number, digits = 2) => Number(value.toFixed(digits))

function dateRange(query: { dateFrom?: string; dateTo?: string }) {
  const createdAt: { gte?: Date; lte?: Date } = {}
  if (query.dateFrom) createdAt.gte = new Date(`${query.dateFrom}T00:00:00+08:00`)
  if (query.dateTo) createdAt.lte = new Date(`${query.dateTo}T23:59:59.999+08:00`)
  return Object.keys(createdAt).length ? createdAt : undefined
}

@Injectable()
export class ManagementLoopService {
  constructor(private prisma: PrismaService, private opLog: OperationLogService, private billing: BillingService) {}

  private async resolveInboundFeeContext(inboundId: number) {
    const order = await this.prisma.inboundOrder.findUnique({ where: { id: BigInt(inboundId) }, include: { items: true } })
    if (!order) throw new NotFoundException('入库单不存在')
    if (!order.omsCustomerCode) return { order, customer: null, rule: null }
    const customer = await this.prisma.customer.findUnique({ where: { customerCode: order.omsCustomerCode } })
    if (!customer) return { order, customer: null, rule: null }
    const now = new Date()
    const rules = await this.prisma.inboundFeeRule.findMany({ where: {
      enabled: true,
      AND: [
        { OR: [{ customerId: customer.id }, { customerId: null }] },
        { OR: [{ warehouseCode: order.warehouseCode }, { warehouseCode: null }] },
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
      ],
    }})
    rules.sort((a, b) => Number(b.customerId != null) * 2 + Number(b.warehouseCode != null) - (Number(a.customerId != null) * 2 + Number(a.warehouseCode != null)))
    return { order, customer, rule: rules[0] || null }
  }

  async previewInboundCharges(inboundId: number) {
    const { order, customer, rule } = await this.resolveInboundFeeContext(inboundId)
    if (!customer) return { available: false, reason: '入库单未匹配到客户', lines: [], totalAmount: 0 }
    if (!rule) return { available: false, reason: '未配置适用的入库计费规则', lines: [], totalAmount: 0 }
    const receivedQty = order.items.reduce((sum, item) => sum + (item.actualQty ?? 0), 0)
    const qcQty = order.items.filter((item) => item.qcStatus !== 'pending').reduce((sum, item) => sum + (item.actualQty ?? 0), 0)
    const putawayQty = order.items.reduce((sum, item) => sum + (item.putawayQty ?? 0), 0)
    const cartonQty = order.receivedCartonCount ?? 0
    const specs = [
      ['inbound_receipt', 'receive', '入库收货费', receivedQty, toNumber(rule.receiveUnitPrice)],
      ['inbound_carton', 'receive', '入库箱处理费', cartonQty, toNumber(rule.receiveCartonPrice)],
      ['inbound_qc', 'qc', '入库质检费', qcQty, toNumber(rule.qcUnitPrice)],
      ['inbound_putaway', 'putaway', '入库上架费', putawayQty, toNumber(rule.putawayUnitPrice)],
    ] as const
    const lines = specs.map(([chargeType, operationType, label, quantity, unitPrice]) => ({
      chargeType, operationType, label, quantity, unitPrice, amount: round(quantity * unitPrice),
    })).filter((line) => line.amount > 0)
    return {
      available: true, customerId: Number(customer.id), customerCode: customer.customerCode,
      rule: { id: Number(rule.id), ruleName: rule.ruleName }, lines,
      totalAmount: round(lines.reduce((sum, line) => sum + line.amount, 0)),
      basis: { receivedQty, cartonQty, qcQty, putawayQty },
    }
  }

  async recordInboundCharges(inboundId: number) {
    const preview = await this.previewInboundCharges(inboundId)
    if (!preview.available || !preview.customerId || !preview.rule) return preview
    const order = await this.prisma.inboundOrder.findUnique({ where: { id: BigInt(inboundId) } })
    if (!order) throw new NotFoundException('入库单不存在')
    const created: any[] = []
    for (const line of preview.lines) {
      created.push(await this.billing.createCharge({
        customerId: preview.customerId, chargeType: line.chargeType, source: 'erp',
        description: `${line.label} · ${order.inboundNo} · ${line.quantity} × ${line.unitPrice}`,
        amount: line.amount, quantity: line.quantity, unitPrice: line.unitPrice,
        bizRef: order.inboundNo, sourceRef: order.inboundNo, warehouseCode: order.warehouseCode,
        operationType: line.operationType,
        idempotencyKey: `inbound:${order.inboundNo}:${line.chargeType}:v1`,
        calcBasis: { ...preview.basis, quantity: line.quantity },
        ruleSnapshot: { ...preview.rule, unitPrice: line.unitPrice }, occurredAt: new Date().toISOString(),
      }))
    }
    return { ...preview, created }
  }

  async reportSummary(query: any) {
    const inbound = await this.inboundReport({ ...query, page: 1, pageSize: 1 })
    const outbound = await this.outboundReport({ ...query, page: 1, pageSize: 1 })
    return { inbound: inbound.summary, outbound: outbound.summary, generatedAt: new Date() }
  }

  async inboundReport(query: any) {
    const page = Math.max(1, Number(query.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20))
    const where: any = {}
    const createdAt = dateRange(query)
    if (createdAt) where.createdAt = createdAt
    if (query.warehouseCode) where.warehouseCode = query.warehouseCode
    if (query.customerCode) where.omsCustomerCode = query.customerCode
    if (query.status) where.status = query.status
    const [rows, total, all] = await Promise.all([
      this.prisma.inboundOrder.findMany({
        where, include: { items: true, cartons: true }, orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.inboundOrder.count({ where }),
      this.prisma.inboundOrder.findMany({ where, include: { items: true }, orderBy: { id: 'desc' } }),
    ])
    const ids = all.map((row) => row.inboundNo)
    const charges = ids.length ? await this.prisma.billingCharge.findMany({ where: { bizRef: { in: ids } } }) : []
    const chargeMap = new Map<string, number>()
    charges.forEach((charge) => chargeMap.set(charge.bizRef || '', (chargeMap.get(charge.bizRef || '') || 0) + toNumber(charge.amount)))
    const totalExpectedQty = all.reduce((sum, row) => sum + row.items.reduce((s, item) => s + item.expectedQty, 0), 0)
    const totalReceivedQty = all.reduce((sum, row) => sum + row.items.reduce((s, item) => s + (item.actualQty ?? 0), 0), 0)
    const completed = all.filter((row) => ['completed', 'confirmed'].includes(row.status))
    const durationHours = completed
      .filter((row) => row.arrivedAt && row.putawayAt)
      .map((row) => (row.putawayAt!.getTime() - row.arrivedAt!.getTime()) / 3600000)
    const statusCounts = all.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1
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
        feeAmount: round(chargeMap.get(row.inboundNo) || 0),
      })),
      total, page, pageSize,
      summary: {
        orderCount: all.length, completedCount: completed.length, statusCounts,
        expectedQty: totalExpectedQty, receivedQty: totalReceivedQty,
        varianceQty: totalReceivedQty - totalExpectedQty,
        completionRate: all.length ? round(completed.length / all.length * 100, 1) : 0,
        avgCycleHours: durationHours.length ? round(durationHours.reduce((a, b) => a + b, 0) / durationHours.length, 1) : 0,
        feeAmount: round(charges.reduce((sum, charge) => sum + toNumber(charge.amount), 0)),
      },
    }
  }

  async outboundReport(query: any) {
    const page = Math.max(1, Number(query.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20))
    const where: any = {}
    const createdAt = dateRange(query)
    if (createdAt) where.createdAt = createdAt
    if (query.warehouseCode) where.warehouseCode = query.warehouseCode
    if (query.customerId) where.customerId = BigInt(query.customerId)
    if (query.status) where.status = query.status
    const [rows, total, all] = await Promise.all([
      this.prisma.outboundOrder.findMany({ where, include: { items: true }, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.outboundOrder.count({ where }),
      this.prisma.outboundOrder.findMany({ where, include: { items: true }, orderBy: { id: 'desc' } }),
    ])
    const refs = all.map((row) => row.outboundNo)
    const charges = refs.length ? await this.prisma.billingCharge.findMany({ where: { bizRef: { in: refs } } }) : []
    const chargeMap = new Map<string, number>()
    charges.forEach((charge) => chargeMap.set(charge.bizRef || '', (chargeMap.get(charge.bizRef || '') || 0) + toNumber(charge.amount)))
    const completed = all.filter((row) => ['shipped', 'delivered'].includes(row.status))
    const requestedQty = all.reduce((sum, row) => sum + row.items.reduce((s, item) => s + item.qty, 0), 0)
    const pickedQty = all.reduce((sum, row) => sum + row.items.reduce((s, item) => s + item.pickedQty, 0), 0)
    const statusCounts = all.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1
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
        orderCount: all.length, completedCount: completed.length, statusCounts,
        requestedQty, pickedQty, shortageQty: Math.max(0, requestedQty - pickedQty),
        fulfillmentRate: all.length ? round(completed.length / all.length * 100, 1) : 0,
        exceptionCount: all.filter((row) => row.isProblem || row.exceptionType).length,
        feeAmount: round(charges.reduce((sum, charge) => sum + toNumber(charge.amount), 0)),
      },
    }
  }

  listFeeRules() {
    return this.prisma.inboundFeeRule.findMany({ orderBy: [{ enabled: 'desc' }, { id: 'desc' }] })
      .then((rows) => rows.map((row) => ({ ...row, id: Number(row.id), customerId: row.customerId ? Number(row.customerId) : null })))
  }

  createFeeRule(body: any, userId?: number) {
    if (!String(body.ruleName || '').trim()) throw new BadRequestException('请输入规则名称')
    return this.prisma.inboundFeeRule.create({ data: {
      ruleName: String(body.ruleName).trim(), customerId: body.customerId ? BigInt(body.customerId) : null,
      warehouseCode: body.warehouseCode || null, receiveUnitPrice: toNumber(body.receiveUnitPrice),
      receiveCartonPrice: toNumber(body.receiveCartonPrice), qcUnitPrice: toNumber(body.qcUnitPrice),
      putawayUnitPrice: toNumber(body.putawayUnitPrice), enabled: body.enabled !== false,
      effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : null,
      effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null,
      createdBy: userId ? BigInt(userId) : null,
    }}).then((row) => ({ ...row, id: Number(row.id) }))
  }

  updateFeeRule(id: number, body: any) {
    return this.prisma.inboundFeeRule.update({ where: { id: BigInt(id) }, data: {
      ruleName: body.ruleName !== undefined ? String(body.ruleName).trim() : undefined,
      customerId: body.customerId !== undefined ? (body.customerId ? BigInt(body.customerId) : null) : undefined,
      warehouseCode: body.warehouseCode !== undefined ? (body.warehouseCode || null) : undefined,
      receiveUnitPrice: body.receiveUnitPrice !== undefined ? toNumber(body.receiveUnitPrice) : undefined,
      receiveCartonPrice: body.receiveCartonPrice !== undefined ? toNumber(body.receiveCartonPrice) : undefined,
      qcUnitPrice: body.qcUnitPrice !== undefined ? toNumber(body.qcUnitPrice) : undefined,
      putawayUnitPrice: body.putawayUnitPrice !== undefined ? toNumber(body.putawayUnitPrice) : undefined,
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
    }}).then((row) => ({ ...row, id: Number(row.id) }))
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
        const currentRows = await tx.inventoryLocation.findMany({
          where: { productId: line.productId, locationId: line.locationId }, orderBy: { id: 'asc' },
        })
        if (!currentRows.length) throw new BadRequestException(`库位库存 ${line.locationCode}/${line.sku} 已不存在`)
        const currentQty = currentRows.reduce((sum, row) => sum + row.qty, 0)
        const delta = finalQty - currentQty
        if (!delta) continue
        if (delta > 0) {
          await tx.inventoryLocation.update({ where: { id: currentRows[0].id }, data: { qty: currentRows[0].qty + delta } })
        } else {
          let remaining = -delta
          for (const row of currentRows) {
            if (!remaining) break
            const deduct = Math.min(row.qty, remaining)
            await tx.inventoryLocation.update({ where: { id: row.id }, data: { qty: row.qty - deduct } })
            remaining -= deduct
          }
        }
        const warehouseInventory = await tx.inventory.findUnique({ where: { productId_warehouseCode: { productId: line.productId, warehouseCode: plan.warehouseCode } } })
        if (!warehouseInventory) throw new BadRequestException(`${line.sku} 仓库总库存不存在`)
        const after = warehouseInventory.totalQty + delta
        if (after < 0) throw new BadRequestException(`${line.sku} 调整后库存不能为负数`)
        await tx.inventory.update({ where: { id: warehouseInventory.id }, data: { totalQty: after, availableQty: Math.max(0, warehouseInventory.availableQty + delta) } })
        await tx.inventoryLog.create({ data: {
          productId: line.productId, sku: line.sku, warehouseCode: plan.warehouseCode,
          changeType: 'stocktake', changeQty: delta, beforeQty: warehouseInventory.totalQty, afterQty: after,
          referenceNo: plan.stocktakeNo, operatorId: userId ? BigInt(userId) : null, remark: `盘点调整 · ${line.locationCode}`,
        }})
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
