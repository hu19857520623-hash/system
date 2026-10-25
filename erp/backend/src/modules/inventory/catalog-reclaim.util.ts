import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { CATALOG_CUSTOMER_CODE, catalogSkuLookupKeys, toCatalogInternalSku } from '../../common/catalog-customer.util'
import { billingCents } from '../billing/billing-workflow.util'
import { catalogRefundReference, paidCatalogPurchase, readCatalogRefunds } from '../billing/catalog-refund-ledger.util'
import { remainingCatalogStock } from '../pricing/catalog-stock.util'
import { withCatalogReceiptCaps } from '../pricing/catalog-receipts.util'
import type { CatalogReclaimDto } from './dto/catalog-reclaim.dto'
import { PermissionsService } from '../../common/permissions/permissions.service'

/** JWT may outlive a role change. Financial authority must use the current account. */
export async function assertRefundAuthority(db: any, actor?: number) {
  if (!Number.isSafeInteger(actor) || !actor || actor <= 0) throw new ForbiddenException('请使用原账号登录后核对收回操作')
  const user = await db.sysUser.findUnique({ where: { id: BigInt(actor) }, select: { roleCode: true, status: true } })
  if (!user || user.status !== 1 || !['admin', 'finance'].includes(user.roleCode)) throw new ForbiddenException('仅当前财务和系统管理员可核对收回退款，请重新登录后确认岗位')
  if (!await new PermissionsService(db).userHasPerm(actor, user.roleCode, 'inventory_query.reclaim_refund')) throw new ForbiddenException('当前账号无收回退款权限，请联系系统管理员核对')
}

async function refundLots(db: any, customer: any, sku: string) {
  const orders: any[] = await db.omsCatalogOrder.findMany({ where: { customerId: customer.id, sku: { in: catalogSkuLookupKeys(sku) }, status: 'confirmed' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
  const charges: any[] = orders.length ? await db.billingCharge.findMany({ where: { customerId: customer.id, source: 'oms', chargeType: 'catalog_purchase', bizRef: { in: orders.map(o => o.orderNo) } } }) : []
  const refunds = await readCatalogRefunds(db, customer), refunded = new Map<number, number>()
  for (const refund of refunds) for (const line of refund.allocations) refunded.set(line.orderId, (refunded.get(line.orderId) || 0) + line.quantity)
  return orders.map(order => {
    const paid = paidCatalogPurchase(order, charges, customer.customerCode), alreadyRefunded = refunded.get(Number(order.id)) || 0
    return { orderId: Number(order.id), orderNo: order.orderNo, purchasedQuantity: order.quantity, alreadyRefunded, refundableQuantity: paid ? Math.max(0, order.quantity - alreadyRefunded) : 0, unitPrice: Number(order.unitPrice), unitCents: paid ? billingCents(order.unitPrice) : 0, paid, createdAt: order.createdAt,
      ...(!paid ? { reason: '原购买付款依据不完整，请先由财务核对' } : {}) }
  })
}
export async function previewCatalogReclaim(prisma: any, data: {customerCode: string;sku: string}, actor?: number) {
  if (!data?.customerCode?.trim() || !data?.sku?.trim()) throw new BadRequestException('请选择客户与商品后核对收回退款')
  return prisma.$transaction(async (db: any) => {
    await assertRefundAuthority(db, actor)
    const customer = await db.customer.findUnique({ where: { customerCode: data.customerCode.trim() } })
    if (!customer) throw new NotFoundException('客户不存在，请返回列表重新选择')
    const holdings = await db.customerSkuInventory.findMany({ where: { customerId: customer.id, sku: { in: catalogSkuLookupKeys(data.sku) }, quantity: { gt: 0 } } })
    if (holdings.length > 1) throw new ConflictException('同一商品存在多份持有记录，请先核对商品编码')
    const lots = await refundLots(db, customer, data.sku)
    return { customerCode: customer.customerCode, sku: data.sku, holdingQuantity: holdings[0]?.quantity ?? 0, balance: Number(customer.balance), lots,
      message: '请选择对应的原购买单和各单数量，按原成交单价退款；不使用当前售价或持有均价' }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 })
}

export async function reclaimCatalog(prisma: any, data: CatalogReclaimDto, actor?: number) {
  if (!Number.isSafeInteger(actor) || !actor || actor <= 0) throw new ForbiddenException('请使用原账号登录后核对收回操作')
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(data?.clientRequestId || '')) throw new BadRequestException('请保留原收回请求标识后重试')
  if (typeof data.customerCode !== 'string' || !data.customerCode.trim() || data.customerCode.length > 30) throw new BadRequestException('请填写有效客户代码')
  if (typeof data.sku !== 'string' || !data.sku.trim() || data.sku.length > 30) throw new BadRequestException('请填写有效商品编码')
  if (!Number.isSafeInteger(data.quantity) || data.quantity <= 0 || data.quantity > 2147483647) throw new BadRequestException('收回数量须为正整数')
  if (data.remark != null && (typeof data.remark !== 'string' || data.remark.length > 500)) throw new BadRequestException('收回备注须为文字且最多500字')
  if (typeof data.expectedRefundAmount !== 'number' || billingCents(data.expectedRefundAmount) <= 0) throw new BadRequestException('请重新核对原购买单的退款金额')
  if (!Array.isArray(data.allocations) || !data.allocations.length || data.allocations.length > 100 || data.allocations.some(a => !Number.isSafeInteger(a?.orderId) || a.orderId <= 0 || !Number.isSafeInteger(a.quantity) || a.quantity <= 0)) throw new BadRequestException('请选择有效的原购买记录和各单退款数量')
  const allocationIds = new Set(data.allocations.map(a => a.orderId))
  if (allocationIds.size !== data.allocations.length || data.allocations.reduce((sum,a) => sum + a.quantity, 0) !== data.quantity) throw new BadRequestException('原购买单不可重复，分摊数量合计须等于收回数量')
  const request = { customerCode: data.customerCode.trim(), sku: data.sku.trim(), quantity: data.quantity, remark: data.remark?.trim() || 'ERP 收回货盘持有', expectedRefundAmount: data.expectedRefundAmount, allocations: [...data.allocations].sort((a,b) => a.orderId-b.orderId) }
  if (request.customerCode.toUpperCase() === CATALOG_CUSTOMER_CODE) throw new BadRequestException('不能从平台货盘客户收回，请指定申购客户')
  const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex')
  return prisma.$transaction(async (tx: any) => {
    await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(actor)} FOR UPDATE`
    await assertRefundAuthority(tx, actor)
    const previous = await tx.operationLog.findFirst({ where: { module: 'inventory', action: 'catalog_reclaim', operatorId: BigInt(actor), detail: { path: '$.clientRequestId', equals: data.clientRequestId } } })
    if (previous) {
      if (previous.detail?.requestFingerprint !== fingerprint) throw new ConflictException('原收回请求对应的客户、商品、数量或备注不同，请核对原操作，勿再次收回')
      return { ...previous.detail.response, duplicate: true }
    }
    const initial = await tx.customer.findUnique({ where: { customerCode: request.customerCode } })
    if (!initial) throw new NotFoundException('客户不存在，请返回列表重新选择')
    await tx.$queryRaw`SELECT id FROM customer WHERE id = ${initial.id} FOR UPDATE`
    const customer = await tx.customer.findUnique({ where: { id: initial.id } })
    if (!customer || customer.status !== 1) throw new BadRequestException('客户已停用，请先核对客户状态')
    const keys = catalogSkuLookupKeys(request.sku)
    const found = await tx.productPricing.findUnique({ where: { sku: toCatalogInternalSku(request.sku) } })
      ?? await tx.productPricing.findFirst({ where: { sku: { in: keys } } })
    if (!found) throw new NotFoundException('商品不在货盘定价池，请返回列表核对')
    await tx.$queryRaw`SELECT id FROM product_pricing WHERE id = ${found.id} FOR UPDATE`
    const rawPricing = await tx.productPricing.findUnique({ where: { id: found.id } })
    const pricing = rawPricing ? (await withCatalogReceiptCaps(tx, [rawPricing]))[0] : null
    await tx.$queryRaw`SELECT id FROM customer_sku_inventory WHERE customer_id = ${customer.id} AND sku IN (${Prisma.join(keys)}) ORDER BY id FOR UPDATE`
    const holdings = await tx.customerSkuInventory.findMany({ where: { customerId: customer.id, sku: { in: keys }, quantity: { gt: 0 } }, orderBy: { id: 'asc' } })
    if (holdings.length > 1) throw new ConflictException('同一商品存在多份持有记录，请先核对商品编码，勿直接收回')
    const holding = holdings[0], qty = request.quantity
    if (!holding || holding.quantity < qty) throw new BadRequestException(`当前可收回仅 ${holding?.quantity ?? 0} 件，请重新读取持有后核对数量`)
    if (!pricing || !Number.isSafeInteger(pricing.soldQty) || pricing.soldQty < qty) throw new ConflictException('持有量与货盘已售记录不一致，请先核对，避免错误回流库存')
    const lots = await refundLots(tx, customer, request.sku)
    const allocations = request.allocations.map(line => {
      const lot = lots.find(item => item.orderId === line.orderId)
      if (!lot?.paid || line.quantity > lot.refundableQuantity) throw new BadRequestException('原购买单的可退款数量或付款依据已变化，本次未收回退款，请重新核对')
      return { orderId: lot.orderId, orderNo: lot.orderNo, quantity: line.quantity, unitCents: lot.unitCents, amountCents: line.quantity * lot.unitCents }
    })
    const refundCents = allocations.reduce((sum,a) => sum+a.amountCents, 0), beforeCents = billingCents(customer.balance)
    if (!Number.isSafeInteger(refundCents) || refundCents <= 0 || refundCents > 99999999999999 || beforeCents + refundCents > 99999999999999) throw new BadRequestException('退款金额或退款后余额超出范围，请分批核对')
    if (refundCents !== billingCents(request.expectedRefundAmount)) throw new ConflictException('退款金额与原购买记录不一致，请核对原请求，勿按当前售价退款')
    let reopenOrderable = false
    if (!pricing.orderableOnOms && pricing.visibleOnOms && pricing.shareStatus !== 'stopped' && remainingCatalogStock({...pricing,soldQty:pricing.soldQty-qty}) > 0) {
      const warehouses = await tx.warehouse.findMany({where:{warehouseType:'wms'},select:{warehouseCode:true}})
      if (warehouses.length) reopenOrderable = !!await tx.inventory.findFirst({where:{sku:{in:keys},warehouseCode:{in:warehouses.map((w:any)=>w.warehouseCode)},availableQty:{gt:0}}})
    }
    const changed = await tx.customerSkuInventory.updateMany({ where: { id: holding.id, quantity: { gte: qty } }, data: { quantity: { decrement: qty } } })
    const sold = await tx.productPricing.updateMany({ where: { id: pricing.id, soldQty: { gte: qty } }, data: { soldQty: { decrement: qty }, ...(reopenOrderable ? {orderableOnOms:true,orderableOnOmsAt:new Date()} : {}) } })
    if (changed.count !== 1 || sold.count !== 1) throw new ConflictException('持有或货盘库存已变化，本次收回已回滚，请重新核对')
    const remainQty = holding.quantity - qty, newSoldQty = pricing.soldQty - qty
    if (!remainQty) await tx.customerSkuInventory.deleteMany({ where: { id: holding.id, quantity: 0 } })
    await tx.customer.update({ where: { id: customer.id }, data: { balance: { increment: (refundCents/100).toFixed(2) } } })
    const refund = { amountCents: refundCents, balanceBefore: beforeCents/100, balanceAfter: (beforeCents+refundCents)/100, allocations }
    const referenceNo = catalogRefundReference(actor,data.clientRequestId)
    const response = { clientRequestId: data.clientRequestId, customerCode: customer.customerCode, sku: holding.sku, quantity: qty, remainingQty: remainQty, catalogSoldQty: newSoldQty, catalogRemainingStock: remainingCatalogStock({ ...pricing, soldQty: newSoldQty }), referenceNo, refundAmount: refundCents/100, balanceBefore: refund.balanceBefore, balanceAfter: refund.balanceAfter, allocations: allocations.map(a => ({...a,unitPrice:a.unitCents/100,amount:a.amountCents/100})), duplicate: false, message: `已收回 ${qty} 件，按原购买单退回 ¥${(refundCents/100).toFixed(2)} 至客户余额，请核对退款流水` }
    await tx.productPricingHistory.create({ data: { pricingId: pricing.id, operatorRole: 'ERP', action: '收回持有', detail: `从客户 ${customer.customerCode} 收回 ${qty} 件（持有 ${holding.quantity} → ${remainQty}）；货盘已售 ${pricing.soldQty} → ${newSoldQty}。${request.remark}` } })
    await tx.syncLog.create({ data: { syncType: 'catalog_reclaim', targetSystem: 'OMS', referenceNo, status: 'success', requestBody: request, responseBody: response } })
    await tx.operationLog.create({ data: { module: 'inventory', action: 'catalog_reclaim', operatorId: BigInt(actor), targetType: 'customer_sku_inventory', targetId: holding.sku, detail: { clientRequestId: data.clientRequestId, requestFingerprint: fingerprint, customerId: Number(customer.id), refundVersion: 1, refund, request, response } } })
    return response
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000 })
}
