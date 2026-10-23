import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { createHash, randomUUID } from 'crypto'
import type { PrismaService } from '../../common/prisma/prisma.service'
import { BILLING_CHARGE_TYPE_LABELS } from './billing.constants'

const ACTIONS = ['billing_generate', 'billing_confirm', 'billing_manual_charge']
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const cleanJson = (value: any) => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? Number(v) : v))
const hash = (value: any) => createHash('sha256').update(JSON.stringify(cleanJson(value))).digest('hex')
export function billingCents(value: unknown) {
  const text = String(value ?? '')
  if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(text)) throw new BadRequestException('金额精度或范围无效，请核对原始费用')
  const [whole, fraction = ''] = text.replace('-', '').split('.')
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(amount)) throw new BadRequestException('金额超出支持范围，请核对原始费用')
  return text.startsWith('-') ? -amount : amount
}
const money = (cents: number) => Number((cents / 100).toFixed(2))
function sum(values: number[]) {
  const amount = values.reduce((a, b) => a + b, 0)
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 99999999999999) throw new BadRequestException('费用合计超出支持范围，请分批核对')
  return amount
}
function date(value: any) {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new BadRequestException('请填写有效的起止日期')
  return value
}
export function billingFilters(data: any) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BadRequestException('请填写有效的账单筛选条件')
  const filters: any = {}
  if (data.customerId != null) {
    if (!Number.isSafeInteger(data.customerId) || data.customerId <= 0) throw new BadRequestException('请选择有效客户')
    filters.customerId = data.customerId
  }
  for (const field of ['customerCode', 'source', 'chargeType']) {
    if (data[field] == null || data[field] === '') continue
    if (typeof data[field] !== 'string' || data[field].trim().length > 30) throw new BadRequestException('账单筛选条件无效，请重新选择')
    const value = data[field].trim(); if (value) filters[field] = field === 'customerCode' ? value.toUpperCase() : value
  }
  if (filters.source && !['erp', 'manual', 'wms', 'oms'].includes(filters.source)) throw new BadRequestException('请选择有效费用来源')
  if (filters.chargeType && !BILLING_CHARGE_TYPE_LABELS[filters.chargeType]) throw new BadRequestException('请选择有效费用类型')
  filters.dateFrom = date(data.dateFrom); filters.dateTo = date(data.dateTo)
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) throw new BadRequestException('开始日期不能晚于结束日期')
  return cleanJson(filters)
}
function operation(data: any, actor?: number, version = true) {
  if (!Number.isSafeInteger(actor) || !actor || actor <= 0) throw new ForbiddenException('请重新登录后核对账务操作')
  if (!uuid.test(data?.clientRequestId || '')) throw new BadRequestException('请提供有效的账务操作标识，重新打开页面后重试')
  if (version && !/^[a-f0-9]{64}$/.test(data.expectedVersion || '')) throw new BadRequestException('请重新核对最新费用与余额后提交')
}
async function original(tx: any, actor: number, clientRequestId: string, fingerprint: string) {
  await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(actor)} FOR UPDATE`
  const previous = await tx.operationLog.findFirst({ where: { module: 'billing', operatorId: BigInt(actor), action: { in: ACTIONS }, detail: { path: '$.clientRequestId', equals: clientRequestId } } })
  if (!previous) return null
  if (previous.detail?.requestFingerprint !== fingerprint) throw new ConflictException('原账务操作对应的内容不同，请核对原请求，勿修改后重试')
  return { ...previous.detail.response, duplicate: true, message: '原账务操作已完成，本次未重复生成或扣费，请查看最新结果' }
}
async function record(tx: any, actor: number, action: string, targetId: string, data: any, fingerprint: string, request: any, response: any, extra: any = {}) {
  await tx.operationLog.create({ data: { module: 'billing', operatorId: BigInt(actor), action, targetType: 'billing', targetId,
    detail: cleanJson({ clientRequestId: data.clientRequestId, requestFingerprint: fingerprint, request, response, ...extra }) } })
}
export async function billingGenerationSnapshot(db: any, data: any) {
  const filters = billingFilters(data), conditions = ["c.status='pending'", 'c.billing_id IS NULL', "NOT (c.source IN ('erp','wms') AND EXISTS (SELECT 1 FROM outbound_order o WHERE o.customer_id=c.customer_id AND o.outbound_no=c.biz_ref AND o.shipped_at IS NULL))"], params: any[] = []
  if (filters.customerId) { conditions.push('c.customer_id=?'); params.push(filters.customerId) }
  if (filters.customerCode) { conditions.push('cust.customer_code=?'); params.push(filters.customerCode) }
  if (filters.source) { conditions.push('c.source=?'); params.push(filters.source) }
  if (filters.chargeType) { conditions.push('c.charge_type=?'); params.push(filters.chargeType) }
  if (filters.dateFrom) { conditions.push('c.charge_date>=?'); params.push(filters.dateFrom) }
  if (filters.dateTo) { conditions.push('c.charge_date<=?'); params.push(filters.dateTo) }
  const charges: any[] = await db.$queryRawUnsafe(`SELECT c.* FROM billing_charge c JOIN customer cust ON cust.id=c.customer_id WHERE ${conditions.join(' AND ')} ORDER BY c.customer_id,c.id`, ...params)
  const total = sum(charges.map(c => { const amount = billingCents(c.amount); if (amount <= 0) throw new BadRequestException('存在非正数费用，请先核对原始账务'); return amount }))
  const expectedVersion = hash({ filters, charges: charges.map(c => ({ id: String(c.id), customerId: String(c.customer_id), amount: String(c.amount), type: c.charge_type, quantity: c.quantity, unitPrice: String(c.unit_price ?? ''), description: c.description, source: c.source, date: c.charge_date, ref: c.biz_ref, status: c.status, billingId: c.billing_id })) })
  return { filters, charges, expectedVersion, chargeCount: charges.length, totalAmount: money(total), customerCount: new Set(charges.map(c => String(c.customer_id))).size }
}
export async function generateBillingOrders(prisma: PrismaService, data: any, actor?: number) {
  operation(data, actor)
  const request = { kind: 'generate', filters: billingFilters(data), expectedVersion: data.expectedVersion }, fingerprint = hash(request)
  return prisma.$transaction(async tx => {
    const replay = await original(tx, actor!, data.clientRequestId, fingerprint); if (replay) return replay
    const before = await billingGenerationSnapshot(tx, data)
    const ids = [...new Set(before.charges.map(c => String(c.customer_id)))].map(id => BigInt(id)).sort((a, b) => a < b ? -1 : 1)
    for (const id of ids) await tx.$queryRaw`SELECT id FROM customer WHERE id = ${id} FOR UPDATE`
    if (before.charges.length) await tx.$queryRawUnsafe(`SELECT id FROM billing_charge WHERE id IN (${before.charges.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`, ...before.charges.map(c => c.id))
    const snapshot = await billingGenerationSnapshot(tx, data)
    if (snapshot.expectedVersion !== data.expectedVersion) throw new ConflictException('费用范围或入账进度已变化，请重新预览后生成账单')
    if (!snapshot.chargeCount) throw new BadRequestException('当前筛选条件下暂无待入账费用')
    const groups = new Map<string, any[]>()
    for (const charge of snapshot.charges) { const id = String(charge.customer_id); groups.set(id, [...(groups.get(id) || []), charge]) }
    const bills: any[] = [], period = (snapshot.filters.dateFrom || new Date().toISOString().slice(0, 10)).slice(0, 7)
    for (const [customerId, charges] of groups) {
      const total = sum(charges.map(c => billingCents(c.amount)))
      const customer = await tx.customer.findUnique({ where: { id: BigInt(customerId) } })
      if (!customer) throw new NotFoundException('客户不存在，请重新核对费用')
      const bill = await tx.billingOrder.create({ data: { billingNo: `BL-${period.replace('-', '')}-${randomUUID().replace(/-/g, '').slice(0, 16)}`, customerId: BigInt(customerId), billingMonth: period, totalAmount: (total / 100).toFixed(2), status: 'pending', remark: '按费用明细生成，确认时仅扣尚未支付部分', items: { create: charges.map(c => ({ itemType: c.charge_type, description: c.description || BILLING_CHARGE_TYPE_LABELS[c.charge_type] || '其他费用', quantity: c.quantity, unitPrice: c.unit_price, amount: c.amount })) } }, include: { items: true } })
      for (const charge of charges) {
        const changed = await tx.$executeRawUnsafe("UPDATE billing_charge SET billing_id=?,status='confirmed' WHERE id=? AND status='pending' AND billing_id IS NULL", bill.id, charge.id)
        if (Number(changed) !== 1) throw new ConflictException('费用已由其它操作入账，本次生成已回滚，请重新预览')
      }
      bills.push({ id: Number(bill.id), billingNo: bill.billingNo, customerId: Number(customerId), customerName: customer.customerName || customer.customerCode, totalAmount: money(total), chargeCount: charges.length, status: 'pending' })
    }
    const response = { bills, count: bills.length, totalCharges: snapshot.chargeCount, duplicate: false, message: '账单已生成，请打开账单核对已付与待扣金额后继续确认' }
    await record(tx, actor!, 'billing_generate', data.clientRequestId, data, fingerprint, request, response)
    return response
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000 })
}

/** Historical browser snapshots are mutable; require the server-only settlement receipt too. */
async function outboundPaidAmounts(db: any, customer: any, charges: any[]) {
  const refs: string[] = [...new Set(charges.filter(c => ['erp', 'wms'].includes(c.source) && c.biz_ref).map(c => String(c.biz_ref)))]
  const result = new Map<string, { amount: number; reason: string; blocked?: string }>()
  if (!refs.length) return result
  const outbounds = await db.outboundOrder.findMany({ where: { customerId: customer.id, outboundNo: { in: refs } } })
  for (const order of outbounds) {
    const related = charges.filter(c => c.biz_ref === order.outboundNo && ['erp', 'wms'].includes(c.source))
    const receipt = await db.operationLog.findFirst({ where: { module: 'billing', action: 'outbound_payment', targetId: order.outboundNo }, orderBy: { id: 'desc' } })
    const paidLines = receipt?.detail?.customerId === Number(customer.id) ? receipt.detail.allocations || [] : []
    if (paidLines.length) {
      for (const charge of related) {
        const paid = paidLines.find((line: any) => String(line.chargeId) === String(charge.id))
        if (paid && billingCents(paid.paidAmount) === billingCents(charge.amount)) result.set(String(charge.id), { amount: billingCents(charge.amount), reason: '发运支付凭据已确认' })
        else result.set(String(charge.id), { amount: 0, reason: '', blocked: '出库费用与支付凭据不一致，请先核对原发运费用' })
      }
      continue
    }
    if (!order.shippedAt || !['shipped', 'delivered', 'partial_delivered', 'delivery_failed', 'exception'].includes(order.status)) {
      for (const charge of related) result.set(String(charge.id), { amount: 0, reason: '', blocked: '出库尚未完成最终费用结算，请先核对发运或退款结果' })
      continue
    }
    const allCharges: any[] = await db.$queryRawUnsafe("SELECT id,amount FROM billing_charge WHERE customer_id=? AND biz_ref=? AND source IN ('erp','wms')", customer.id, order.outboundNo)
    const total = sum(allCharges.map(c => billingCents(c.amount)))
    const receipts: any[] = await db.$queryRawUnsafe('SELECT id,title,content FROM oms_systemmessage WHERE id=?', `erp-msg-fees-${order.outboundNo}`)
    const serverReceipt = receipts.length === 1 && receipts[0].title === `出库 ${order.outboundNo} 费用已结算` && receipts[0].content.startsWith(`实扣 ¥${money(total).toFixed(2)}，`)
    for (const charge of related) {
      result.set(String(charge.id), serverReceipt
        ? { amount: billingCents(charge.amount), reason: '历史发运实扣已对账' }
        : { amount: 0, reason: '', blocked: '出库已付记录尚未完整核对，请先恢复原发运费用同步，不能再次扣费' })
    }
  }
  return result
}
async function sourcePaidAmounts(db: any, customer: any, charges: any[]) {
  const result = await outboundPaidAmounts(db, customer, charges)
  const purchases = charges.filter(c => c.source === 'oms' && c.charge_type === 'catalog_purchase')
  if (!purchases.length) return result
  const orders = await db.omsCatalogOrder.findMany({ where: { customerId: customer.id, orderNo: { in: purchases.map(c => String(c.biz_ref || '')) } } })
  for (const charge of purchases) {
    const order = orders.find((o: any) => o.orderNo === charge.biz_ref)
    const related: any[] = await db.$queryRawUnsafe("SELECT id,amount FROM billing_charge WHERE customer_id=? AND biz_ref=? AND source='oms' AND charge_type='catalog_purchase'", customer.id, charge.biz_ref || '')
    const paid = order && order.status === 'confirmed' && order.customerCode === customer.customerCode && order.balanceBefore != null && order.balanceAfter != null
      && billingCents(order.totalAmount) === billingCents(charge.amount) && billingCents(order.balanceBefore) - billingCents(order.balanceAfter) === billingCents(order.totalAmount)
      && related.length === 1 && String(related[0].id) === String(charge.id)
    result.set(String(charge.id), paid ? { amount: billingCents(charge.amount), reason: '货盘采购订单实扣已核对' }
      : { amount: 0, reason: '', blocked: '货盘采购已付记录不完整，请先核对原采购订单，不能再次扣款' })
  }
  return result
}
/** Payment is independent of charge assignment/confirmation status. */
export async function billingPaidChargeIds(db: any, customer: any, charges: any[]) {
  const result = new Set<string>()
  const billIds = [...new Set(charges.filter(c => c.billing_id).map(c => BigInt(c.billing_id)))]
  const bills = billIds.length ? await db.billingOrder.findMany({ where: { id: { in: billIds }, customerId: customer.id } }) : []
  const paidBills = new Set(bills.filter((b: any) => billingCents(b.totalAmount) > 0 && billingCents(b.paidAmount) === billingCents(b.totalAmount) && ['paid', 'confirmed'].includes(b.status)).map((b: any) => String(b.id)))
  for (const c of charges) if (paidBills.has(String(c.billing_id))) result.add(String(c.id))
  const remaining = charges.filter(c => !result.has(String(c.id)))
  const outbound = await sourcePaidAmounts(db, customer, remaining)
  for (const c of remaining) if (outbound.get(String(c.id))?.amount === billingCents(c.amount)) result.add(String(c.id))
  return result
}
export async function billingSettlementSnapshot(db: any, id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new BadRequestException('账单编号无效，请返回列表重新选择')
  const bill = await db.billingOrder.findUnique({ where: { id: BigInt(id) }, include: { items: { orderBy: { id: 'asc' } } } })
  if (!bill) throw new NotFoundException('账单不存在，请返回列表重新读取')
  const customer = await db.customer.findUnique({ where: { id: bill.customerId } })
  if (!customer) throw new NotFoundException('账单客户不存在，请核对原始资料')
  const charges: any[] = await db.$queryRawUnsafe('SELECT * FROM billing_charge WHERE billing_id=? ORDER BY id', bill.id)
  const total = billingCents(bill.totalAmount), recordedPaid = billingCents(bill.paidAmount), balance = billingCents(customer.balance), blockedReasons: string[] = []
  if (total <= 0 || !charges.length || charges.some(c => billingCents(c.amount) <= 0) || sum(charges.map(c => billingCents(c.amount))) !== total || sum(bill.items.map((i: any) => billingCents(i.amount))) !== total || charges.some(c => String(c.customer_id) !== String(customer.id))) blockedReasons.push('账单合计与关联费用不一致，请核对原始费用后重新生成')
  if (!['pending', 'confirmed', 'paid'].includes(bill.status)) blockedReasons.push('当前账单状态不可扣款，请重新读取最新进度')
  if (recordedPaid < 0 || recordedPaid > total || (recordedPaid > 0 && recordedPaid < total)) blockedReasons.push('账单有历史部分支付金额但缺少逐笔分配依据，请先核对历史支付凭据')
  const paid = recordedPaid === total ? new Map() : await sourcePaidAmounts(db, customer, charges)
  const lines = charges.map(c => {
    const amount = billingCents(c.amount), proof = paid.get(String(c.id)), paidAmount = recordedPaid === total ? amount : proof?.amount || 0
    if (proof?.blocked) blockedReasons.push(proof.blocked)
    return { id: Number(c.id), chargeNo: c.charge_no, chargeType: BILLING_CHARGE_TYPE_LABELS[c.charge_type] || '其他费用', description: c.description || '', amount: money(amount), alreadyPaidAmount: money(paidAmount), toDeductAmount: money(amount - paidAmount), paidReason: recordedPaid === total ? '本账单已支付' : proof?.reason || '尚未支付', bizRef: c.biz_ref }
  })
  const alreadyPaid = sum(lines.map(c => billingCents(c.alreadyPaidAmount))), toDeduct = total - alreadyPaid
  const expectedVersion = hash({ bill: cleanJson(bill), charges, payment: lines, balance: String(customer.balance), customerId: String(customer.id) })
  const balanceSufficient = toDeduct === 0 || balance >= toDeduct
  return { id, billingNo: bill.billingNo, customerId: Number(customer.id), customerName: customer.customerName || customer.customerCode, status: bill.status, totalAmount: money(total), alreadyPaidAmount: money(alreadyPaid), toDeductAmount: money(toDeduct), balance: money(balance), remainingBalance: money(balance - toDeduct), blockedReasons: [...new Set(blockedReasons)], expectedVersion, charges: lines, canConfirm: !blockedReasons.length && balanceSufficient, balanceSufficient }
}
export async function confirmBillingOrder(prisma: PrismaService, id: number, data: any, actor?: number) {
  operation(data, actor)
  if (!Number.isSafeInteger(id) || id <= 0) throw new BadRequestException('请选择有效账单')
  const request = { kind: 'confirm', id, expectedVersion: data.expectedVersion }, fingerprint = hash(request)
  return prisma.$transaction(async tx => {
    const replay = await original(tx, actor!, data.clientRequestId, fingerprint); if (replay) return replay
    const initial = await tx.billingOrder.findUnique({ where: { id: BigInt(id) } })
    if (!initial) throw new NotFoundException('账单不存在，请返回列表重新读取')
    await tx.$queryRaw`SELECT id FROM customer WHERE id = ${initial.customerId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM billing_order WHERE id = ${BigInt(id)} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM billing_charge WHERE billing_id = ${BigInt(id)} ORDER BY id FOR UPDATE`
    const completed = await tx.operationLog.findFirst({ where: { module: 'billing', action: 'billing_confirm', targetId: initial.billingNo }, orderBy: { id: 'desc' } })
    if (completed?.detail && (completed.detail as any).response) return { ...(completed.detail as any).response, duplicate: true, message: '本账单已完成支付核对，本次未再次扣款' }
    const snapshot = await billingSettlementSnapshot(tx, id)
    if (snapshot.expectedVersion !== data.expectedVersion) throw new ConflictException('账单、支付凭据或余额已变化，请重新核对后确认')
    if (snapshot.blockedReasons.length) throw new BadRequestException(snapshot.blockedReasons.join('；'))
    if (!snapshot.balanceSufficient) throw new BadRequestException(`余额不足：本次仅需扣未付费用 ¥${snapshot.toDeductAmount.toFixed(2)}，当前余额 ¥${snapshot.balance.toFixed(2)}；请先充值后重新核对`)
    if (snapshot.toDeductAmount > 0) {
      const changed = await tx.customer.updateMany({ where: { id: initial.customerId, balance: { gte: snapshot.toDeductAmount } }, data: { balance: { decrement: snapshot.toDeductAmount } } })
      if (changed.count !== 1) throw new ConflictException('客户余额已变化，本次扣款已回滚，请重新核对')
    }
    await tx.billingOrder.update({ where: { id: BigInt(id) }, data: { paidAmount: snapshot.totalAmount, status: 'paid' } })
    const response = { id, billingNo: snapshot.billingNo, customerId: snapshot.customerId, totalAmount: snapshot.totalAmount, alreadyPaidAmount: snapshot.alreadyPaidAmount, deductedAmount: snapshot.toDeductAmount, balanceBefore: snapshot.balance, balanceAfter: snapshot.remainingBalance, paidAmount: snapshot.totalAmount, status: 'paid', duplicate: false, message: `账单已结清，本次仅扣未付费用 ¥${snapshot.toDeductAmount.toFixed(2)}，已付费用未重复扣款` }
    await record(tx, actor!, 'billing_confirm', snapshot.billingNo, data, fingerprint, request, response, { customerId: snapshot.customerId, allocations: snapshot.charges })
    return response
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000 })
}
export async function createManualBillingCharge(prisma: PrismaService, data: any, actor: number, create: (body: any, tx: any) => Promise<any>) {
  operation(data, actor, false)
  if (!Number.isSafeInteger(data.customerId) || data.customerId <= 0 || typeof data.amount !== 'number' || billingCents(data.amount) <= 0 || !BILLING_CHARGE_TYPE_LABELS[data.chargeType]) throw new BadRequestException('请核对收费客户、类型与有效金额')
  const chargeDate = date(data.chargeDate); if (!chargeDate) throw new BadRequestException('请填写实际收费日期')
  if (data.description != null && (typeof data.description !== 'string' || data.description.trim().length > 500)) throw new BadRequestException('费用说明过长或无效')
  const request = { kind: 'manual-charge', customerId: data.customerId, amount: data.amount, chargeType: data.chargeType, description: data.description?.trim() || '', chargeDate }, fingerprint = hash(request)
  return prisma.$transaction(async tx => {
    const replay = await original(tx, actor, data.clientRequestId, fingerprint); if (replay) return replay
    await tx.$queryRaw`SELECT id FROM customer WHERE id = ${BigInt(data.customerId)} FOR UPDATE`
    const created = await create({ ...request, kind: undefined, source: 'manual', idempotencyKey: `manual-billing:${actor}:${data.clientRequestId}` }, tx)
    const response = { ...created, customerId: data.customerId, duplicate: false, message: '手工费用已录入，可返回费用列表核对并生成账单' }
    await record(tx, actor, 'billing_manual_charge', created.chargeNo, data, fingerprint, request, response)
    return response
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000 })
}
