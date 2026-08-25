import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'

const PURCHASE_COST_TYPES = new Set(['采购货款', '采购税费', 'Logo费用', '纸箱费用', '备用纸箱'])
const FREIGHT_COST_TYPES = new Set(['国内运费', '海运费', '海运', '物流费'])

export type ProfitQuery = {
  period?: string
  month?: string
  dateFrom?: string
  dateTo?: string
  keyword?: string
  customerId?: string | number
  supplierId?: string | number
  dim?: string
}

type DateRange = {
  start: Date | null
  end: Date | null
  from: string | null
  to: string | null
}

@Injectable()
export class ProfitService {
  constructor(private prisma: PrismaService) {}

  async summary(q: ProfitQuery) {
    const range = this.rangeFromQuery(q)
    const customerId = this.parseId(q.customerId)
    const supplierId = this.parseId(q.supplierId)
    const keyword = this.normalizeKeyword(q.keyword)
    const costWhere = await this.costWhere(range, customerId, supplierId)

    const chargeSql = this.chargeSumSql(range, customerId)
    const [charges, ledger, freightBills, skuCount] = await Promise.all([
      this.prisma.$queryRawUnsafe<{ total: unknown }[]>(chargeSql.sql, ...chargeSql.params),
      this.prisma.costLedger.findMany({
        where: costWhere,
        select: { costType: true, amountRmb: true },
      }),
      this.prisma.supplierFreightBill.findMany({
        where: {
          ...this.dateFilter('createdAt', range),
          ...(supplierId != null ? { supplierId } : {}),
        },
        select: { totalAmount: true, source: true },
      }),
      this.prisma.product.count({ where: { status: 'active' } }),
    ])

    const salesAmount = Number(charges[0]?.total ?? 0)
    let purchaseCost = 0
    let ledgerFreight = 0
    for (const row of ledger) {
      const amount = Number(row.amountRmb || 0)
      if (FREIGHT_COST_TYPES.has(row.costType)) ledgerFreight += amount
      else if (PURCHASE_COST_TYPES.has(row.costType) || !row.costType) purchaseCost += amount
      else purchaseCost += amount
    }
    const billFreight = customerId
      ? 0
      : freightBills
          .filter((b) => b.source !== 'finance_approve')
          .reduce((s, b) => s + Number(b.totalAmount || 0), 0)
    const freightCost = Math.round((ledgerFreight + billFreight) * 100) / 100
    const totalCost = Math.round((purchaseCost + freightCost) * 100) / 100
    const grossProfit = Math.round((salesAmount - totalCost) * 100) / 100
    const purchase = await this.purchaseAnalysis(range, { supplierId, keyword })

    return {
      salesAmount: Math.round(salesAmount * 100) / 100,
      totalCost,
      freightCost,
      grossProfit,
      profitRate: salesAmount ? Number(((grossProfit / salesAmount) * 100).toFixed(2)) : 0,
      skuCount,
      purchase,
      range: { from: range.from, to: range.to },
    }
  }

  async detail(q: ProfitQuery) {
    const range = this.rangeFromQuery(q)
    const dim = String(q.dim || 'sku')
    const keyword = this.normalizeKeyword(q.keyword)
    const customerId = this.parseId(q.customerId)
    if (dim === 'customer') return this.detailByCustomer(range, { keyword, customerId })
    if (dim === 'channel') return this.detailByChannel(range, { keyword, customerId })
    return this.detailBySku(range, { keyword, customerId, supplierId: this.parseId(q.supplierId) })
  }

  private rangeFromQuery(q: ProfitQuery): DateRange {
    const dateFrom = String(q.dateFrom || '').trim()
    const dateTo = String(q.dateTo || '').trim()
    if (dateFrom || dateTo || q.period === 'custom') {
      return {
        start: this.parseDay(dateFrom, false),
        end: this.parseDay(dateTo, true),
        from: dateFrom || null,
        to: dateTo || null,
      }
    }
    if (q.period === 'all') {
      return { start: null, end: null, from: null, to: null }
    }

    const now = new Date()
    let start: Date
    let end: Date
    if (q.month && /^\d{4}-\d{2}$/.test(q.month)) {
      const [y, m] = q.month.split('-').map(Number)
      start = new Date(y, m - 1, 1)
      end = new Date(y, m, 0, 23, 59, 59, 999)
    } else if (q.period === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    } else if (q.period === 'year') {
      start = new Date(now.getFullYear(), 0, 1)
      end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)
    } else if (q.period === 'quarter') {
      const month = Math.floor(now.getMonth() / 3) * 3
      start = new Date(now.getFullYear(), month, 1)
      end = new Date(now.getFullYear(), month + 3, 0, 23, 59, 59, 999)
    } else {
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    }
    return {
      start,
      end,
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    }
  }

  private parseDay(value: string, endOfDay: boolean): Date | null {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
    const [y, m, d] = value.split('-').map(Number)
    return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d)
  }

  private parseId(value: string | number | undefined): bigint | undefined {
    if (value == null || value === '') return undefined
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? BigInt(n) : undefined
  }

  private normalizeKeyword(value?: string) {
    const kw = String(value || '').trim().toLowerCase()
    return kw || undefined
  }

  private dateFilter(field: string, range: DateRange): Record<string, unknown> {
    if (!range.start && !range.end) return {}
    return {
      [field]: {
        ...(range.start ? { gte: range.start } : {}),
        ...(range.end ? { lte: range.end } : {}),
      },
    }
  }

  private chargeSumSql(range: DateRange, customerId?: bigint) {
    const clauses = ['1=1']
    const params: Array<string | number> = []
    if (range.from) {
      clauses.push('charge_date >= ?')
      params.push(range.from)
    }
    if (range.to) {
      clauses.push('charge_date <= ?')
      params.push(range.to)
    }
    if (customerId != null) {
      clauses.push('customer_id = ?')
      params.push(Number(customerId))
    }
    return {
      sql: `SELECT COALESCE(SUM(amount), 0) as total FROM billing_charge WHERE ${clauses.join(' AND ')}`,
      params,
    }
  }

  private async costWhere(range: DateRange, customerId?: bigint, supplierId?: bigint): Promise<Prisma.CostLedgerWhereInput> {
    const where: Prisma.CostLedgerWhereInput = { ...this.dateFilter('costDate', range) }
    const and: Prisma.CostLedgerWhereInput[] = []
    if (customerId != null) {
      const skus = await this.skusForCustomer(customerId, range)
      and.push({ sku: { in: skus.length ? skus : ['__none__'] } })
    }
    if (supplierId != null) {
      const pos = await this.prisma.purchaseOrder.findMany({
        where: { supplierId, ...this.dateFilter('createdAt', range) },
        select: { poNo: true },
      })
      const poNos = pos.map((p) => p.poNo).filter(Boolean)
      and.push({ referenceNo: { in: poNos.length ? poNos : ['__none__'] } })
    }
    if (and.length) where.AND = and
    return where
  }

  private async skusForCustomer(customerId: bigint, range: DateRange) {
    const orders = await this.prisma.outboundOrder.findMany({
      where: {
        customerId,
        status: { not: 'cancelled' },
        ...this.dateFilter('createdAt', range),
      },
      select: { items: { select: { sku: true } } },
    })
    return [...new Set(orders.flatMap((o) => o.items.map((i) => i.sku).filter(Boolean)))]
  }

  private async detailBySku(
    range: DateRange,
    opts: { keyword?: string; customerId?: bigint; supplierId?: bigint },
  ) {
    const rows = await this.prisma.costLedger.findMany({
      where: await this.costWhere(range, opts.customerId, opts.supplierId),
      select: { sku: true, costType: true, amountRmb: true },
    })
    const map = new Map<string, { sku: string; productName: string; salesQty: number; salesAmount: number; totalCost: number; freight: number }>()
    for (const row of rows) {
      const sku = row.sku || '未分摊'
      const cur = map.get(sku) || { sku, productName: sku, salesQty: 0, salesAmount: 0, totalCost: 0, freight: 0 }
      const amount = Number(row.amountRmb || 0)
      if (FREIGHT_COST_TYPES.has(row.costType)) cur.freight += amount
      else cur.totalCost += amount
      map.set(sku, cur)
    }
    const outbounds = await this.prisma.outboundOrder.findMany({
      where: {
        ...this.dateFilter('createdAt', range),
        ...(opts.customerId != null ? { customerId: opts.customerId } : {}),
        status: { in: ['shipped', 'delivered', 'packed', 'pending_pick', 'picking', 'picked', 'reviewing', 'pending_relabel'] },
      },
      include: { items: true },
    })
    for (const order of outbounds) {
      for (const item of order.items) {
        const cur = map.get(item.sku) || {
          sku: item.sku,
          productName: item.productName || item.sku,
          salesQty: 0,
          salesAmount: 0,
          totalCost: 0,
          freight: 0,
        }
        cur.salesQty += item.pickedQty || item.qty
        if (item.productName) cur.productName = item.productName
        map.set(item.sku, cur)
      }
    }
    return [...map.values()]
      .filter((row) => this.matchesKeyword(opts.keyword, row.sku, row.productName))
      .map((row) => {
        const grossProfit = Math.round((row.salesAmount - row.totalCost - row.freight) * 100) / 100
        return {
          sku: row.sku,
          productName: row.productName,
          salesQty: row.salesQty,
          salesAmount: Math.round(row.salesAmount * 100) / 100,
          totalCost: Math.round(row.totalCost * 100) / 100,
          freight: Math.round(row.freight * 100) / 100,
          grossProfit,
          profitRate: row.salesAmount ? Number((grossProfit / row.salesAmount).toFixed(4)) : 0,
        }
      })
      .sort((a, b) => b.totalCost - a.totalCost || b.salesQty - a.salesQty)
      .slice(0, 200)
  }

  private async detailByCustomer(range: DateRange, opts: { keyword?: string; customerId?: bigint }) {
    const clauses = ['1=1']
    const params: Array<string | number> = []
    if (range.from) {
      clauses.push('c.charge_date >= ?')
      params.push(range.from)
    }
    if (range.to) {
      clauses.push('c.charge_date <= ?')
      params.push(range.to)
    }
    if (opts.customerId != null) {
      clauses.push('c.customer_id = ?')
      params.push(Number(opts.customerId))
    }
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT c.customer_id as customerId, COALESCE(SUM(c.amount), 0) as salesAmount, COUNT(*) as qty
       FROM billing_charge c
       WHERE ${clauses.join(' AND ')}
       GROUP BY c.customer_id
       ORDER BY salesAmount DESC
       LIMIT 200`,
      ...params,
    )
    const ids = rows.map((r) => BigInt(r.customerId)).filter(Boolean)
    const customers = ids.length
      ? await this.prisma.customer.findMany({
          where: { id: { in: ids } },
          select: { id: true, customerName: true, customerCode: true },
        })
      : []
    const nameMap = new Map(customers.map((c) => [Number(c.id), c.customerName || c.customerCode]))
    return rows
      .map((r) => {
        const name = nameMap.get(Number(r.customerId)) || `客户 #${r.customerId}`
        const salesAmount = Number(r.salesAmount || 0)
        return {
          sku: name,
          productName: name,
          salesQty: Number(r.qty || 0),
          salesAmount,
          totalCost: 0,
          freight: 0,
          grossProfit: salesAmount,
          profitRate: salesAmount ? 1 : 0,
        }
      })
      .filter((row) => this.matchesKeyword(opts.keyword, row.sku, row.productName))
  }

  private async detailByChannel(range: DateRange, opts: { keyword?: string; customerId?: bigint }) {
    const orders = await this.prisma.outboundOrder.findMany({
      where: {
        ...this.dateFilter('createdAt', range),
        ...(opts.customerId != null ? { customerId: opts.customerId } : {}),
        status: { not: 'cancelled' },
      },
      include: { items: true },
    })
    const map = new Map<string, { sku: string; productName: string; salesQty: number; salesAmount: number }>()
    for (const order of orders) {
      const channel = order.platform || order.destType || '未标注渠道'
      const cur = map.get(channel) || { sku: channel, productName: channel, salesQty: 0, salesAmount: 0 }
      cur.salesQty += order.items.reduce((s, i) => s + (i.pickedQty || i.qty), 0)
      map.set(channel, cur)
    }
    return [...map.values()]
      .filter((row) => this.matchesKeyword(opts.keyword, row.sku, row.productName))
      .map((row) => ({
        ...row,
        totalCost: 0,
        freight: 0,
        grossProfit: 0,
        profitRate: 0,
      }))
      .sort((a, b) => b.salesQty - a.salesQty)
  }

  private async purchaseAnalysis(range: DateRange, opts: { supplierId?: bigint; keyword?: string }) {
    const orders = await this.prisma.purchaseOrder.findMany({
      where: {
        ...this.dateFilter('createdAt', range),
        ...(opts.supplierId != null ? { supplierId: opts.supplierId } : {}),
      },
      select: {
        supplierId: true,
        totalAmount: true,
        createdAt: true,
        expectedArrival: true,
        status: true,
      },
    })
    const grouped = new Map<number, {
      poCount: number
      totalAmt: number
      leadDays: number[]
      onTime: number
    }>()
    for (const po of orders) {
      const id = Number(po.supplierId)
      const cur = grouped.get(id) || { poCount: 0, totalAmt: 0, leadDays: [], onTime: 0 }
      cur.poCount += 1
      cur.totalAmt += Number(po.totalAmount || 0)
      if (po.expectedArrival) {
        const days = Math.max(0, Math.round((po.expectedArrival.getTime() - po.createdAt.getTime()) / 86400000))
        cur.leadDays.push(days)
      }
      if (['finance_approved', 'at_logistics_wh', 'wms', 'received', 'completed', 'approved'].includes(po.status)) {
        cur.onTime += 1
      }
      grouped.set(id, cur)
    }
    const supplierIds = [...grouped.keys()].map((id) => BigInt(id))
    const suppliers = supplierIds.length
      ? await this.prisma.supplier.findMany({
          where: { id: { in: supplierIds } },
          select: { id: true, supplierName: true, supplierCode: true },
        })
      : []
    const nameMap = new Map(suppliers.map((s) => [Number(s.id), s.supplierName || s.supplierCode]))
    return [...grouped.entries()]
      .map(([id, row]) => {
        const avgLead = row.leadDays.length
          ? Math.round(row.leadDays.reduce((s, n) => s + n, 0) / row.leadDays.length)
          : 0
        const onTimeRate = row.poCount ? Math.round((row.onTime / row.poCount) * 100) : 0
        return {
          dim: nameMap.get(id) || `供应商 #${id}`,
          poCount: row.poCount,
          totalAmt: Math.round(row.totalAmt * 100) / 100,
          avgLead: avgLead ? `${avgLead} 天` : '—',
          onTime: `${onTimeRate}%`,
          quality: onTimeRate >= 80 ? '优' : onTimeRate >= 50 ? '良' : '一般',
        }
      })
      .filter((row) => this.matchesKeyword(opts.keyword, row.dim))
      .sort((a, b) => b.totalAmt - a.totalAmt)
  }

  private matchesKeyword(keyword: string | undefined, ...fields: Array<string | null | undefined>) {
    if (!keyword) return true
    return fields.some((f) => String(f || '').toLowerCase().includes(keyword))
  }
}
