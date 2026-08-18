import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { notifyOms } from '../../common/oms-notify.util'
import { parseOmsOutboundPreDeduct } from '../../common/oms-sync-meta.util'
import { CreateBillingChargeDto, CreateBillingOrderDto, GenerateBillingDto } from './dto/billing.dto'

export const BILLING_CHARGE_TYPE_LABELS: Record<string, string> = {
  wms_outbound: 'WMS出库单',
  order_fee: '订单处理费',
  catalog_purchase: '货盘采购',
  picking: '拣货费',
  storage: '仓储费',
  outbound_ship: '出库运费',
  relabel: '换标',
  repack: '换箱',
  handling: '手工作业',
  inspection: '质检',
  return_receipt: '退件收货费',
  return_measure: '退件测量费',
  return_handling: '退件操作费',
  return_logistics: '退件物流费',
  return_inspection: '退件质检费',
  return_destroy: '退件销毁费',
  return_repack: '退件包装费',
  return_restock: '退件上架费',
  return_relabel: '退件换标费',
  return_extra: '退件附加费',
  other: '其他工费',
}

@Injectable()
export class BillingService {
  constructor(private prisma: PrismaService) {}

  /** 费用编号展示：客户代码 + 原编号，如 CUS-001-CHG-007 */
  private formatChargeNo(customerCode: string | null | undefined, chargeNo: string): string {
    const code = (customerCode || '').trim()
    const no = (chargeNo || '').trim()
    if (!code || !no) return no || code
    const prefix = `${code}-`
    return no.startsWith(prefix) ? no : `${prefix}${no}`
  }

  private async nextChargeSuffix(customerId: number, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<string> {
    const rows: any[] = await db.$queryRawUnsafe(
      'SELECT charge_no FROM billing_charge WHERE customer_id = ? ORDER BY id DESC LIMIT 1',
      customerId,
    )
    const last = String(rows[0]?.charge_no || '')
    const match = last.match(/CHG-(\d+)$/)
    const next = match ? Number(match[1]) + 1 : 1
    return `CHG-${String(next).padStart(3, '0')}`
  }

  private mapFeeLineType(type?: string, chargeType?: string) {
    const raw = String(chargeType || type || '').toLowerCase()
    if (raw.includes('ship') || raw === 'freight' || raw === 'shipping') return 'outbound_ship'
    if (raw.includes('pick')) return 'picking'
    if (raw.includes('relabel') || raw.includes('label')) return 'relabel'
    if (raw.includes('storage')) return 'storage'
    if (raw.includes('order')) return 'order_fee'
    if (raw.includes('inspect')) return 'inspection'
    return 'handling'
  }

  async listChargesByBizRef(bizRef: string, tx?: Prisma.TransactionClient) {
    const ref = String(bizRef || '').trim()
    if (!ref) return []
    const db = tx ?? this.prisma
    const rows: any[] = await db.$queryRawUnsafe(
      'SELECT id, charge_no, charge_type, amount, description, biz_ref FROM billing_charge WHERE biz_ref = ? ORDER BY id ASC',
      ref,
    )
    return rows.map((r) => ({
      id: Number(r.id),
      chargeNo: String(r.charge_no || ''),
      chargeType: String(r.charge_type || 'other'),
      amount: Number(r.amount || 0),
      description: String(r.description || ''),
      bizRef: r.biz_ref || ref,
    }))
  }

  async recordOutboundCharges(input: {
    customerId: number
    outboundNo: string
    warehouseCode?: string
    source?: string
    lines: { type?: string; chargeType?: string; label?: string; amount: number; detail?: string }[]
  }, tx?: Prisma.TransactionClient) {
    const existing = await this.listChargesByBizRef(input.outboundNo, tx)
    if (existing.length) return existing
    const created: Awaited<ReturnType<BillingService['createCharge']>>[] = []
    for (const line of input.lines || []) {
      const amount = Math.round(Number(line.amount || 0) * 100) / 100
      if (!(amount > 0)) continue
      created.push(
        await this.createCharge({
          customerId: input.customerId,
          chargeType: this.mapFeeLineType(line.type, line.chargeType),
          source: input.source || 'erp',
          description: `${line.label || '出库费用'} · ${input.outboundNo}${line.detail ? ` · ${line.detail}` : ''}`,
          amount,
          quantity: 1,
          unitPrice: amount,
          bizRef: input.outboundNo,
          sourceRef: input.outboundNo,
          warehouseCode: input.warehouseCode,
        }, tx),
      )
    }
    return created
  }

  /** 把已存在的 OMS 出库预扣补进结算明细，避免下单后本页空白 */
  private async backfillOutboundCharges() {
    try {
      const orders = await this.prisma.outboundOrder.findMany({
        where: { customerId: { not: null }, status: { not: 'cancelled' } },
        select: { outboundNo: true, customerId: true, warehouseCode: true, remark: true, createdAt: true },
        orderBy: { id: 'desc' },
        take: 200,
      })
      for (const order of orders) {
        if (!order.customerId) continue
        const preDeduct = parseOmsOutboundPreDeduct(order.remark)
        const lines = (preDeduct?.lines || []).filter((l) => Number(l.amount) > 0)
        if (!lines.length) continue
        await this.recordOutboundCharges({
          customerId: Number(order.customerId),
          outboundNo: order.outboundNo,
          warehouseCode: order.warehouseCode,
          source: 'erp',
          lines,
        })
      }
    } catch {
      /* 补账失败不阻断费用列表 */
    }
  }

  async listCharges(q: PaginationDto & { customerId?: number; chargeType?: string; source?: string; status?: string; dateFrom?: string; dateTo?: string }) {
    await this.backfillOutboundCharges()
    const { page, pageSize } = getPagination(q)
    const conds: string[] = ['1=1']
    const params: unknown[] = []
    if (q.customerId) { conds.push('c.customer_id = ?'); params.push(q.customerId) }
    if (q.chargeType) { conds.push('c.charge_type = ?'); params.push(q.chargeType) }
    if (q.source) { conds.push('c.source = ?'); params.push(q.source) }
    if (q.status) { conds.push('c.status = ?'); params.push(q.status) }
    if (q.dateFrom) { conds.push('c.charge_date >= ?'); params.push(q.dateFrom) }
    if (q.dateTo) { conds.push('c.charge_date <= ?'); params.push(q.dateTo) }
    if (q.keyword) {
      conds.push('(c.charge_no LIKE ? OR c.description LIKE ? OR c.biz_ref LIKE ?)')
      const kw = `%${q.keyword}%`
      params.push(kw, kw, kw)
    }
    const where = conds.join(' AND ')
    const countRows: any[] = await this.prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM billing_charge c WHERE ${where}`, ...params)
    const total = Number(countRows[0]?.cnt ?? 0)
    const offset = (page - 1) * pageSize
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT c.* FROM billing_charge c WHERE ${where} ORDER BY c.charge_date DESC, c.id DESC LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      offset,
    )
    const customerIds = [...new Set(rows.map((r) => Number(r.customer_id)))]
    const customers = customerIds.length
      ? await this.prisma.customer.findMany({ where: { id: { in: customerIds.map((id) => BigInt(id)) } } })
      : []
    const nameMap = new Map(customers.map((c) => [Number(c.id), c.customerName || c.customerCode]))
    const codeMap = new Map(customers.map((c) => [Number(c.id), c.customerCode]))
    const items = rows.map((r) => {
      const customerCode = codeMap.get(Number(r.customer_id)) || null
      const rawChargeNo = r.charge_no
      return {
      id: Number(r.id),
      chargeNo: this.formatChargeNo(customerCode, rawChargeNo),
      rawChargeNo,
      customerId: Number(r.customer_id),
      customerCode,
      customerName: nameMap.get(Number(r.customer_id)) || `客户 #${r.customer_id}`,
      chargeType: r.charge_type,
      chargeTypeLabel: BILLING_CHARGE_TYPE_LABELS[r.charge_type] || r.charge_type,
      source: r.source,
      description: r.description,
      amount: Number(r.amount),
      quantity: r.quantity,
      unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
      chargeDate: r.charge_date,
      bizRef: r.biz_ref,
      sourceRef: r.source_ref,
      warehouseCode: r.warehouse_code,
      status: r.status,
      billingId: r.billing_id ? Number(r.billing_id) : null,
    }
    })
    return { items, total, page, pageSize }
  }

  async createCharge(data: CreateBillingChargeDto, tx?: Prisma.TransactionClient) {
    if (!data.customerId) throw new BadRequestException('请选择客户')
    if (!data.amount || Number(data.amount) <= 0) throw new BadRequestException('请填写有效金额')
    const db = tx ?? this.prisma
    const customer = await db.customer.findUnique({ where: { id: BigInt(data.customerId) } })
    if (!customer) throw new BadRequestException('客户不存在')
    const suffix = data.chargeNo || await this.nextChargeSuffix(Number(data.customerId), db)
    const chargeNo = this.formatChargeNo(customer.customerCode, suffix)
    const chargeDate = data.chargeDate || new Date().toISOString().slice(0, 10)
    await db.$executeRawUnsafe(
      `INSERT INTO billing_charge (charge_no, customer_id, charge_type, source, description, amount, quantity, unit_price, charge_date, biz_ref, source_ref, warehouse_code, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      chargeNo,
      BigInt(data.customerId),
      data.chargeType || 'other',
      data.source || 'manual',
      data.description || '',
      Number(data.amount),
      data.quantity ?? 1,
      data.unitPrice ?? data.amount,
      chargeDate,
      data.bizRef || null,
      data.sourceRef || '手工录入',
      data.warehouseCode || 'WMS-JHB-01',
    )
    const rows: { id: bigint; charge_type: string; amount: unknown; description: string; biz_ref: string | null }[] =
      await db.$queryRawUnsafe(
        'SELECT id, charge_type, amount, description, biz_ref FROM billing_charge WHERE charge_no = ? LIMIT 1',
        chargeNo,
      )
    const row = rows[0]
    return {
      chargeNo,
      id: row ? Number(row.id) : undefined,
      chargeType: String(row?.charge_type || data.chargeType || 'other'),
      amount: Number(row?.amount ?? data.amount),
      description: String(row?.description || data.description || ''),
      bizRef: row?.biz_ref || data.bizRef || null,
      ok: true,
    }
  }

  async list(q: PaginationDto & { status?: string; customerId?: number }) {
    const { page, pageSize } = getPagination(q)
    const where: any = {}
    if (q.status) where.status = q.status
    if (q.customerId) where.customerId = BigInt(q.customerId)
    if (q.keyword) where.billingNo = { contains: q.keyword }
    const [rows, total] = await Promise.all([
      this.prisma.billingOrder.findMany({ where, include: { items: true }, skip: (page - 1) * pageSize, take: pageSize, orderBy: { id: 'desc' } }),
      this.prisma.billingOrder.count({ where }),
    ])
    const customerIds = [...new Set(rows.map((r) => r.customerId))]
    const customers = customerIds.length
      ? await this.prisma.customer.findMany({ where: { id: { in: customerIds } } })
      : []
    const nameMap = new Map(customers.map((c) => [Number(c.id), c.customerName || c.customerCode]))
    const items = rows.map((r) => ({
      ...r,
      id: Number(r.id),
      customerId: Number(r.customerId),
      customerName: nameMap.get(Number(r.customerId)) || `客户 #${r.customerId}`,
      totalAmount: Number(r.totalAmount),
      paidAmount: Number(r.paidAmount),
      items: r.items.map((i) => ({ ...i, id: Number(i.id), amount: Number(i.amount), unitPrice: i.unitPrice != null ? Number(i.unitPrice) : null })),
    }))
    return { items, total, page, pageSize }
  }

  async detail(id: number) {
    const row = await this.prisma.billingOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true } })
    if (!row) throw new NotFoundException('账单不存在')
    const customer = await this.prisma.customer.findUnique({ where: { id: row.customerId } })
    return {
      ...row,
      id: Number(row.id),
      customerId: Number(row.customerId),
      customerName: customer?.customerName || customer?.customerCode,
      totalAmount: Number(row.totalAmount),
      items: row.items.map((i) => ({ ...i, id: Number(i.id), amount: Number(i.amount) })),
    }
  }

  /** 汇总待入账费用生成账单（按客户） */
  async generateFromCharges(data: GenerateBillingDto) {
    const conds = ["status = 'pending'", 'billing_id IS NULL']
    const params: unknown[] = []
    if (data.dateFrom) { conds.push('charge_date >= ?'); params.push(data.dateFrom) }
    if (data.dateTo) { conds.push('charge_date <= ?'); params.push(data.dateTo) }
    if (data.customerId) { conds.push('customer_id = ?'); params.push(data.customerId) }
    const where = conds.join(' AND ')
    const pending: any[] = await this.prisma.$queryRawUnsafe(`SELECT * FROM billing_charge WHERE ${where}`, ...params)
    if (!pending.length) throw new BadRequestException('当前时间范围内暂无待入账费用')

    const byCustomer = new Map<number, any[]>()
    pending.forEach((c) => {
      const cid = Number(c.customer_id)
      if (!byCustomer.has(cid)) byCustomer.set(cid, [])
      byCustomer.get(cid)!.push(c)
    })

    const period = (data.dateFrom || pending[0].charge_date?.toISOString?.()?.slice(0, 10) || new Date().toISOString().slice(0, 10)).slice(0, 7)

    return this.prisma.$transaction(async (tx) => {
      const created: any[] = []
      for (const [customerId, charges] of byCustomer) {
        const total = charges.reduce((s, c) => s + Number(c.amount), 0)
        const billingNo = `BL-${period.replace('-', '')}-${customerId}-${Date.now().toString().slice(-4)}`
        const order = await tx.billingOrder.create({
          data: {
            billingNo,
            customerId: BigInt(customerId),
            billingMonth: period,
            totalAmount: total,
            status: 'pending',
            remark: data.dateFrom && data.dateTo ? `${data.dateFrom} ~ ${data.dateTo}` : undefined,
            items: {
              create: charges.map((c) => ({
                itemType: c.charge_type,
                description: c.description || BILLING_CHARGE_TYPE_LABELS[c.charge_type] || c.charge_type,
                quantity: c.quantity ?? 1,
                unitPrice: c.unit_price ?? c.amount,
                amount: c.amount,
              })),
            },
          },
          include: { items: true },
        })

        for (const c of charges) {
          await tx.$executeRawUnsafe(
            `UPDATE billing_charge SET billing_id = ?, status = 'confirmed' WHERE id = ?`,
            order.id,
            c.id,
          )
        }

        const customer = await tx.customer.findUnique({ where: { id: BigInt(customerId) } })
        created.push({
          ...order,
          id: Number(order.id),
          customerId,
          customerName: customer?.customerName || customer?.customerCode,
          totalAmount: Number(order.totalAmount),
          chargeCount: charges.length,
        })
      }

      return { bills: created, count: created.length, totalCharges: pending.length }
    })
  }

  /** 兼容旧接口：手动指定明细创建账单 */
  generate(data: CreateBillingOrderDto) {
    const lines = data.items
    const total = lines.reduce((s, i) => s + Number(i.amount ?? 0), 0)
    return this.prisma.billingOrder.create({
      data: {
        billingNo: data.billingNo || 'BL-' + Date.now().toString().slice(-8),
        customerId: BigInt(data.customerId),
        billingMonth: data.billingMonth,
        totalAmount: total,
        status: 'pending',
        items: {
          create: lines.map((i) => ({
            itemType: i.itemType || 'other',
            description: i.description,
            quantity: i.quantity ?? 1,
            unitPrice: i.unitPrice,
            amount: i.amount,
          })),
        },
      },
      include: { items: true },
    })
  }

  async previewGenerate(data: GenerateBillingDto) {
    const conds = ["status = 'pending'", 'billing_id IS NULL']
    const params: unknown[] = []
    if (data.dateFrom) { conds.push('charge_date >= ?'); params.push(data.dateFrom) }
    if (data.dateTo) { conds.push('charge_date <= ?'); params.push(data.dateTo) }
    if (data.customerId) { conds.push('customer_id = ?'); params.push(data.customerId) }
    const where = conds.join(' AND ')
    const rows: any[] = await this.prisma.$queryRawUnsafe(`SELECT customer_id, amount FROM billing_charge WHERE ${where}`, ...params)
    const customerIds = [...new Set(rows.map((r) => Number(r.customer_id)))]
    return {
      chargeCount: rows.length,
      totalAmount: rows.reduce((s, r) => s + Number(r.amount), 0),
      customerCount: customerIds.length,
    }
  }

  async confirm(id: number) {
    await this.detail(id)
    const updated = await this.prisma.billingOrder.update({
      where: { id: BigInt(id) },
      data: { status: 'confirmed' },
    })
    const customer = await this.prisma.customer.findUnique({ where: { id: updated.customerId } })
    if (customer) {
      void notifyOms('billing.changed', customer.customerCode, {
        billingNo: updated.billingNo,
        status: 'confirmed',
        totalAmount: Number(updated.totalAmount),
      })
    }
    return updated
  }

  /** OMS P2：客户费用明细 */
  async listChargesForOms(customerCode: string) {
    const code = customerCode.trim()
    if (!code) throw new BadRequestException('缺少客户编码')
    const customer = await this.prisma.customer.findUnique({ where: { customerCode: code } })
    if (!customer) throw new NotFoundException(`客户代码 ${code} 不存在`)
    const result = await this.listCharges({
      customerId: Number(customer.id),
      page: 1,
      pageSize: 200,
    } as any)
    return {
      customerCode: code,
      customerName: customer.customerName,
      balance: Number(customer.balance),
      items: result.items,
      total: result.total,
    }
  }

  /** OMS P2：客户账单列表 */
  async listBillsForOms(customerCode: string) {
    const code = customerCode.trim()
    if (!code) throw new BadRequestException('缺少客户编码')
    const customer = await this.prisma.customer.findUnique({ where: { customerCode: code } })
    if (!customer) throw new NotFoundException(`客户代码 ${code} 不存在`)
    const result = await this.list({
      customerId: Number(customer.id),
      page: 1,
      pageSize: 100,
    } as any)
    return {
      customerCode: code,
      items: result.items,
      total: result.total,
    }
  }
}
