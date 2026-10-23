import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { notifyOms } from '../../common/oms-notify.util'
import { readableDisplayText } from '../../common/display-text.util'
import { CreateBillingChargeDto, CreateBillingOrderDto, GenerateBillingDto, SubmitGenerateBillingDto, BillingOperationDto, CreateManualBillingChargeDto } from './dto/billing.dto'
import {
  applyDestinationSqlFilter,
  DESTINATION_JOIN_SQL,
  inboundChargeFulfillment,
  outboundChargeFulfillment,
  resolveDestinationFilter,
  returnChargeFulfillment,
  type ChargeFulfillment,
} from './billing-charge-fulfillment.util'
import { billingPaidChargeIds, billingGenerationSnapshot, billingSettlementSnapshot, generateBillingOrders, confirmBillingOrder, createManualBillingCharge } from './billing-workflow.util'
import { inferTakealotDestFromWarehouseHint } from '../outbound/oms-warehouse.util'
import { billingSourceSnapshot } from './billing-snapshot.util'

import { BILLING_CHARGE_TYPE_LABELS } from './billing.constants'
export { BILLING_CHARGE_TYPE_LABELS } from './billing.constants'

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

  async listCharges(q: PaginationDto & { customerId?: number; customerCode?: string; chargeType?: string; source?: string; status?: string; dateFrom?: string; dateTo?: string; destination?: string }) {
    const { page, pageSize } = getPagination(q)
    const conds: string[] = ['1=1']
    const params: unknown[] = []
    if (q.customerId) { conds.push('c.customer_id = ?'); params.push(q.customerId) }
    if (q.customerCode?.trim()) {
      conds.push('cust.customer_code = ?')
      params.push(q.customerCode.trim().toUpperCase())
    }
    if (q.chargeType) { conds.push('c.charge_type = ?'); params.push(q.chargeType) }
    if (q.source) { conds.push('c.source = ?'); params.push(q.source) }
    if (q.status) { conds.push('c.status = ?'); params.push(q.status) }
    if (q.dateFrom) { conds.push('c.charge_date >= ?'); params.push(q.dateFrom) }
    if (q.dateTo) { conds.push('c.charge_date <= ?'); params.push(q.dateTo) }
    const destinationJoins = q.destination?.trim() ? DESTINATION_JOIN_SQL : ''
    if (q.destination?.trim()) {
      applyDestinationSqlFilter(
        conds,
        params,
        q.destination,
        [
          ...await this.matchReturnNosByDestination(q.destination),
          ...await this.matchOutboundNosByDestination(q.destination),
        ],
      )
    }
    const fromSql = `billing_charge c LEFT JOIN customer cust ON cust.id = c.customer_id ${destinationJoins}`
    if (q.keyword) {
      conds.push('(c.charge_no LIKE ? OR c.description LIKE ? OR c.biz_ref LIKE ? OR cust.customer_code LIKE ? OR cust.customer_name LIKE ?)')
      const kw = `%${q.keyword}%`
      params.push(kw, kw, kw, kw, kw)
    }
    const where = conds.join(' AND ')
    const countRows: any[] = await this.prisma.$queryRawUnsafe(`SELECT COUNT(DISTINCT c.id) as cnt FROM ${fromSql} WHERE ${where}`, ...params)
    const total = Number(countRows[0]?.cnt ?? 0)
    const offset = (page - 1) * pageSize
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT DISTINCT c.* FROM ${fromSql} WHERE ${where} ORDER BY c.charge_date DESC, c.id DESC LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      offset,
    )
    const customerIds = [...new Set(rows.map((r) => Number(r.customer_id)))]
    const customers = customerIds.length
      ? await this.prisma.customer.findMany({ where: { id: { in: customerIds.map((id) => BigInt(id)) } } })
      : []
    const nameMap = new Map(customers.map((c) => [Number(c.id), readableDisplayText(c.customerName, c.customerCode)]))
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
    const fulfillmentByRef = await this.loadChargeFulfillment(
      items.map((item) => String(item.bizRef || '').trim()).filter(Boolean),
    )
    const warehouseCodes = [...new Set(items.map((item) => String(item.warehouseCode || '').trim()).filter(Boolean))]
    const warehouses = warehouseCodes.length
      ? await this.prisma.warehouse.findMany({
          where: { warehouseCode: { in: warehouseCodes } },
          select: { warehouseCode: true, warehouseName: true, city: true },
        })
      : []
    const warehouseMap = new Map(warehouses.map((row) => [row.warehouseCode, row]))
    return {
      items: items.map((item) => {
        const extra = fulfillmentByRef.get(String(item.bizRef || ''))
        const warehouse = warehouseMap.get(String(item.warehouseCode || ''))
        const warehouseHint = inferTakealotDestFromWarehouseHint(
          item.warehouseCode,
          warehouse?.warehouseName,
          warehouse?.city,
        )
        return {
          ...item,
          destination: extra?.destination || warehouseHint || item.warehouseCode || '—',
          skuItems: extra?.skuItems || [],
        }
      }),
      total,
      page,
      pageSize,
    }
  }

  private async loadChargeFulfillment(refs: string[]): Promise<Map<string, ChargeFulfillment>> {
    const unique = [...new Set(refs.filter(Boolean))]
    const result = new Map<string, ChargeFulfillment>()
    if (!unique.length) return result
    const [outbounds, inbounds] = await Promise.all([
      this.prisma.outboundOrder.findMany({
        where: { outboundNo: { in: unique } },
        select: {
          outboundNo: true,
          fbaWarehouse: true,
          platform: true,
          destType: true,
          recipientJson: true,
          warehouseCode: true,
          items: { select: { sku: true, productName: true, qty: true, pickedQty: true } },
        },
      }),
      this.prisma.inboundOrder.findMany({
        where: { inboundNo: { in: unique } },
        select: {
          inboundNo: true,
          warehouseCode: true,
          items: { select: { sku: true, expectedQty: true, actualQty: true } },
        },
      }),
    ])
    let returns: Array<{
      returnNo: string
      returnWarehouse: string | null
      items: Array<{ sku: string; productName: string; quantity: number }>
    }> = []
    try {
      returns = await this.prisma.returnOrder.findMany({
        where: { returnNo: { in: unique } },
        select: {
          returnNo: true,
          returnWarehouse: true,
          items: { select: { sku: true, productName: true, quantity: true } },
        },
      })
    } catch {
      returns = []
    }
    const warehouseCodes = [...new Set([
      ...inbounds.map((row) => row.warehouseCode).filter(Boolean),
      ...returns.map((row) => row.returnWarehouse).filter(Boolean),
    ])] as string[]
    const warehouses = warehouseCodes.length
      ? await this.prisma.warehouse.findMany({
          where: { warehouseCode: { in: warehouseCodes } },
          select: { warehouseCode: true, warehouseName: true, city: true },
        })
      : []
    const warehouseMap = new Map(warehouses.map((row) => [row.warehouseCode, row]))
    for (const order of outbounds) {
      result.set(order.outboundNo, outboundChargeFulfillment(order))
    }
    for (const order of inbounds) {
      const warehouse = warehouseMap.get(order.warehouseCode)
      result.set(order.inboundNo, inboundChargeFulfillment({
        warehouseCode: order.warehouseCode,
        warehouseName: warehouse?.warehouseName,
        warehouseCity: warehouse?.city,
        items: order.items,
      }))
    }
    for (const order of returns) {
      const warehouse = order.returnWarehouse ? warehouseMap.get(order.returnWarehouse) : undefined
      result.set(order.returnNo, returnChargeFulfillment({
        returnWarehouse: order.returnWarehouse,
        warehouseName: warehouse?.warehouseName,
        items: order.items,
      }))
    }
    return result
  }

  private async matchOutboundNosByDestination(destination: string): Promise<string[]> {
    const resolved = resolveDestinationFilter(destination)
    if (!resolved) return []
    try {
      const clauses: Array<Record<string, unknown>> = []
      for (const like of resolved.likes) {
        clauses.push({ recipientJson: { contains: like } })
      }
      if (!clauses.length) return []
      const rows = await this.prisma.outboundOrder.findMany({
        where: { OR: clauses as any },
        select: { outboundNo: true },
        take: 500,
      })
      return [...new Set(rows.map((row) => row.outboundNo).filter(Boolean))]
    } catch {
      return []
    }
  }

  private async matchReturnNosByDestination(destination: string): Promise<string[]> {
    const resolved = resolveDestinationFilter(destination)
    if (!resolved) return []
    try {
      const clauses: Array<Record<string, unknown>> = []
      if (resolved.fbaCodes.length) clauses.push({ returnWarehouse: { in: resolved.fbaCodes } })
      for (const like of resolved.likes) {
        clauses.push({ returnWarehouse: { contains: like } })
      }
      if (!clauses.length) return []
      const rows = await this.prisma.returnOrder.findMany({
        where: { OR: clauses as any },
        select: { returnNo: true },
        take: 500,
      })
      return [...new Set(rows.map((row) => row.returnNo).filter(Boolean))]
    } catch {
      return []
    }
  }

  async createCharge(data: CreateBillingChargeDto, tx?: Prisma.TransactionClient, notifyInBackground = true) {
    if (!data.customerId) throw new BadRequestException('请选择客户')
    if (!data.amount || Number(data.amount) <= 0) throw new BadRequestException('请填写有效金额')
    const db = tx ?? this.prisma
    const customer = await db.customer.findUnique({ where: { id: BigInt(data.customerId) } })
    if (!customer) throw new BadRequestException('客户不存在')
    const suffix = data.chargeNo || await this.nextChargeSuffix(Number(data.customerId), db)
    const chargeNo = this.formatChargeNo(customer.customerCode, suffix)
    const chargeDate = data.chargeDate || new Date().toISOString().slice(0, 10)
    if (data.idempotencyKey) {
      const duplicate: any[] = await db.$queryRawUnsafe(
        'SELECT id, charge_no, charge_type, amount, description, biz_ref FROM billing_charge WHERE idempotency_key = ? LIMIT 1',
        data.idempotencyKey,
      )
      if (duplicate[0]) {
        return {
          id: Number(duplicate[0].id),
          chargeNo: String(duplicate[0].charge_no),
          chargeType: String(duplicate[0].charge_type),
          amount: Number(duplicate[0].amount),
          description: String(duplicate[0].description || ''),
          bizRef: duplicate[0].biz_ref || null,
          duplicate: true,
          ok: true,
        }
      }
    }
    await db.$executeRawUnsafe(
      `INSERT INTO billing_charge (charge_no, customer_id, charge_type, source, description, amount, quantity, unit_price, charge_date, biz_ref, source_ref, warehouse_code, status, operation_type, idempotency_key, calc_basis, rule_snapshot, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
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
      data.operationType || null,
      data.idempotencyKey || null,
      data.calcBasis ? JSON.stringify(data.calcBasis) : null,
      data.ruleSnapshot ? JSON.stringify(data.ruleSnapshot) : null,
      data.occurredAt ? new Date(data.occurredAt) : new Date(),
    )
    const rows: { id: bigint; charge_type: string; amount: unknown; description: string; biz_ref: string | null }[] =
      await db.$queryRawUnsafe(
        'SELECT id, charge_type, amount, description, biz_ref FROM billing_charge WHERE charge_no = ? LIMIT 1',
        chargeNo,
      )
    const row = rows[0]
    const created = {
      chargeNo,
      id: row ? Number(row.id) : undefined,
      chargeType: String(row?.charge_type || data.chargeType || 'other'),
      amount: Number(row?.amount ?? data.amount),
      description: String(row?.description || data.description || ''),
      bizRef: row?.biz_ref || data.bizRef || null,
      ok: true,
    }
    if (!tx && notifyInBackground) {
      void this.pushCustomerBillingToOms(Number(data.customerId))
    }
    return created
  }

  async list(q: PaginationDto & { status?: string; customerId?: number; customerCode?: string }) {
    const { page, pageSize } = getPagination(q)
    const where: any = {}
    if (q.status) where.status = q.status
    if (q.customerId) where.customerId = BigInt(q.customerId)
    if (q.customerCode?.trim()) {
      const matches = await this.prisma.customer.findMany({ where: { customerCode: q.customerCode.trim().toUpperCase() }, select: { id: true } })
      where.customerId = q.customerId ? { in: matches.filter(c => Number(c.id) === Number(q.customerId)).map(c => c.id) } : { in: matches.map(c => c.id) }
    }
    if (q.keyword) where.billingNo = { contains: q.keyword }
    const [rows, total] = await Promise.all([
      this.prisma.billingOrder.findMany({ where, include: { items: true }, skip: (page - 1) * pageSize, take: pageSize, orderBy: { id: 'desc' } }),
      this.prisma.billingOrder.count({ where }),
    ])
    const customerIds = [...new Set(rows.map((r) => r.customerId))]
    const customers = customerIds.length
      ? await this.prisma.customer.findMany({ where: { id: { in: customerIds } } })
      : []
    const nameMap = new Map(customers.map((c) => [Number(c.id), readableDisplayText(c.customerName, c.customerCode)]))
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
      customerName: readableDisplayText(customer?.customerName, customer?.customerCode),
      totalAmount: Number(row.totalAmount),
      paidAmount: Number(row.paidAmount),
      items: row.items.map((i) => ({ ...i, id: Number(i.id), amount: Number(i.amount) })),
    }
  }

  /** 原请求可在生成后核对；费用归属与账单明细在同一事务提交。 */
  async generateFromCharges(data: SubmitGenerateBillingDto, userId?: number) {
    return this.syncBillingWorkflow(await generateBillingOrders(this.prisma, data, userId))
  }

  async createManualCharge(data: CreateManualBillingChargeDto, userId: number) {
    return this.syncBillingWorkflow(await createManualBillingCharge(this.prisma, data, userId, (body, tx) => this.createCharge(body, tx)))
  }

  async settlementPreview(id: number) {
    return billingSettlementSnapshot(this.prisma, id)
  }

  private async syncBillingWorkflow(result: any) {
    const customerIds: number[] = [...new Set<number>(result.bills ? result.bills.map((bill: any) => Number(bill.customerId)) : [Number(result.customerId)])]
    let pending = false
    for (const customerId of customerIds) {
      const ok = await this.pushCustomerBillingToOms(customerId, result.status === 'paid' ? { billingNo: result.billingNo, status: 'paid', totalAmount: result.totalAmount } : undefined)
      if (!ok) pending = true
    }
    return pending ? { ...result, syncPending: true, warning: '账务操作已保存，但OMS账单或余额同步未完成；请用原操作重试，勿重新生成或扣款' } : { ...result, syncPending: false }
  }

  /** 旧的无来源账单不能判断费用是否已经扣款，请走有原始费用关联的入口。 */
  generate(_data: CreateBillingOrderDto) {
    throw new BadRequestException('请先在客户结算页录入原始费用，再通过“生成账单”核对并汇总；不能创建缺少费用关联的账单')
  }

  async previewGenerate(data: GenerateBillingDto) {
    const { charges: _charges, filters: _filters, ...preview } = await billingGenerationSnapshot(this.prisma, data)
    return preview
  }

  async confirm(id: number, data: BillingOperationDto, userId?: number) {
    return this.syncBillingWorkflow(await confirmBillingOrder(this.prisma, id, data, userId))
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
    const raw: any[] = await this.prisma.$queryRawUnsafe("SELECT * FROM billing_charge WHERE customer_id=? AND status IN ('pending','confirmed') ORDER BY id", customer.id)
    const paidIds = await billingPaidChargeIds(this.prisma, customer, raw)
    return {
      customerCode: code,
      customerName: readableDisplayText(customer.customerName, customer.customerCode),
      balance: Number(customer.balance),
      items: result.items.map(item => ({ ...item, paymentStatus: paidIds.has(String(item.id)) ? 'paid' : 'unpaid' })),
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

  /** One consistent source snapshot; reading never repairs or mutates OMS caches. */
  async snapshotForOms(customerCode: string) {
    const code = String(customerCode || '').trim().toUpperCase()
    if (!code) throw new BadRequestException('缺少客户编码，请重新登录后核对账单')
    return this.prisma.$transaction(async tx => {
      const customer = await tx.customer.findUnique({ where: { customerCode: code } })
      if (!customer) throw new NotFoundException('客户不存在，请核对当前客户身份')
      const snapshot = await billingSourceSnapshot(tx, customer)
      const bills = await tx.billingOrder.findMany({ where: { customerId: customer.id }, orderBy: { id: 'desc' } })
      return { customerCode: code, customerName: customer.customerName || code, creditBalance: Number(customer.balance), feeRecords: snapshot.feeRecords,
        monthlySpent: snapshot.monthlyTotal, pendingBill: snapshot.pendingTotal, reservedAmount: snapshot.reservedAmount, reviewAmount: snapshot.reviewAmount, billingMonth: snapshot.billingMonth, provisionalChargeCount: snapshot.provisionalChargeCount,
        bills: bills.map(b => ({ id: Number(b.id), customerId: Number(customer.id), customerName: customer.customerName || code, billingNo: b.billingNo, billingMonth: b.billingMonth, status: b.status, totalAmount: Number(b.totalAmount), paidAmount: Number(b.paidAmount) })), source: 'erp', snapshotAt: new Date().toISOString() }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 })
  }

  /** 账单归属不代表已付款，只把有支付依据的费用写成实扣。 */
  async pushCustomerBillingToOms(
    customerId: number,
    extra?: { billingNo?: string; status?: string; totalAmount?: number },
  ): Promise<boolean> {
    try {
      const customer = await this.prisma.customer.findUnique({ where: { id: BigInt(customerId) } })
      if (!customer) return false
      await this.ensureOmsBillingMirror(customer)

    const { confirmed, pendingRows, pendingTotal, monthlyTotal, recharges, refunds } = await billingSourceSnapshot(this.prisma, customer)

    return notifyOms('billing.changed', customer.customerCode, {
      balance: Number(customer.balance),
      pendingBill: pendingTotal,
      monthlySpent: monthlyTotal,
      charges: confirmed.map((c) => ({
        id: Number(c.id),
        chargeNo: String(c.charge_no || ''),
        chargeType: String(c.charge_type || 'other'),
        amount: Number(c.amount || 0),
        description: String(c.description || ''),
        bizRef: c.biz_ref,
        chargeDate: this.toChargeDateStr(c.charge_date),
      })),
      recharges: recharges.map((r) => ({
        rechargeNo: r.rechargeNo,
        amount: Number(r.amount),
        paymentMethod: r.paymentMethod,
        remark: r.remark,
        createdAt: r.createdAt.toISOString(),
      })),
      refunds: refunds.map(r => ({referenceNo:r.referenceNo,amount:r.amount,createdAt:r.createdAt,allocations:r.allocations})),
      removeChargeIds: pendingRows.map((r) => Number(r.id)),
      ...(extra?.billingNo
        ? {
            billingNo: extra.billingNo,
            status: extra.status || 'confirmed',
            totalAmount: extra.totalAmount ?? 0,
          }
        : {}),
    })
    } catch (err) {
      console.warn(
        `[billing] push OMS failed for customer ${customerId}:`,
        err instanceof Error ? err.message : err,
      )
      return false
    }
  }

  async replayOmsBilling(): Promise<{ customerCode: string; balance: number; ok: boolean }[]> {
    const customers = await this.prisma.customer.findMany({ orderBy: { id: 'asc' } })
    const out: { customerCode: string; balance: number; ok: boolean }[] = []
    for (const customer of customers) {
      const ok = await this.pushCustomerBillingToOms(Number(customer.id))
      out.push({ customerCode: customer.customerCode, balance: Number(customer.balance), ok })
    }
    return out
  }

  private toChargeDateStr(value: Date | string | null | undefined): string {
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    return String(value || '').slice(0, 10)
  }

  private async ensureOmsBillingMirror(customer: {
    customerCode: string
    customerName: string
    companyName: string | null
    contactEmail: string | null
    contactName: string | null
    contactPhone: string | null
    balance: unknown
    status: number
  }): Promise<void> {
    const code = customer.customerCode.trim()
    const accountId = `erp-customer-${code.toLowerCase()}`
    const billingId = `erp-billing-${code.toLowerCase()}`
    const omsStatus = customer.status === 1 ? 'active' : 'disabled'
    const email = (customer.contactEmail || '').trim() || `${code.toLowerCase()}@erp.local`
    const warehouse = 'jhb1'

    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO \`oms_customeraccount\`
        (\`id\`, \`name\`, \`code\`, \`type\`, \`contact\`, \`email\`, \`status\`,
         \`permissions\`, \`warehouse\`, \`createdAt\`, \`lastLoginAt\`,
         \`companyName\`, \`contactPhone\`)
      VALUES (
        ${accountId},
        ${customer.customerName},
        ${code},
        ${'ecommerce'},
        ${customer.contactName || customer.customerName},
        ${email},
        ${omsStatus},
        ${'[]'},
        ${warehouse},
        ${new Date().toISOString()},
        ${''},
        ${customer.companyName},
        ${customer.contactPhone}
      )
      ON DUPLICATE KEY UPDATE
        \`name\` = VALUES(\`name\`),
        \`contact\` = VALUES(\`contact\`),
        \`email\` = VALUES(\`email\`),
        \`status\` = VALUES(\`status\`),
        \`companyName\` = VALUES(\`companyName\`),
        \`contactPhone\` = VALUES(\`contactPhone\`)
    `)

    const accounts = await this.prisma.$queryRaw<Array<{ id: string; warehouse: string | null }>>(
      Prisma.sql`SELECT id, warehouse FROM \`oms_customeraccount\` WHERE code = ${code} LIMIT 1`,
    )
    const resolvedId = accounts[0]?.id
    if (!resolvedId) throw new Error(`OMS customer account missing after upsert: ${code}`)
    const resolvedWarehouse = accounts[0]?.warehouse || warehouse

    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO \`oms_billingaccount\`
        (\`id\`, \`customerId\`, \`name\`, \`code\`, \`contact\`, \`warehouse\`,
         \`creditBalance\`, \`monthlySpent\`, \`pendingBill\`, \`budgetUsed\`)
      VALUES (
        ${billingId},
        ${resolvedId},
        ${customer.customerName},
        ${code},
        ${customer.contactName || customer.customerName},
        ${resolvedWarehouse},
        ${Number(customer.balance)},
        ${0},
        ${0},
        ${0}
      )
      ON DUPLICATE KEY UPDATE
        \`name\` = VALUES(\`name\`),
        \`code\` = VALUES(\`code\`),
        \`contact\` = VALUES(\`contact\`),
        \`warehouse\` = VALUES(\`warehouse\`),
        \`creditBalance\` = VALUES(\`creditBalance\`)
    `)
  }
}
