import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { billingCents } from '../billing/billing-workflow.util'
import { PrismaService } from '../../common/prisma/prisma.service'
import { BillingService } from '../billing/billing.service'
import { catalogStockPool, remainingCatalogStock } from './catalog-stock.util'
import { pushCatalogStockToOms } from './oms-catalog-sync.util'
import { catalogSkuLookupKeys, toCatalogInternalSku } from '../../common/catalog-customer.util'

function num(v: unknown, fallback = 0): number {
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export type OmsPurchaseInput = {
  orderNo: string
  customerId?: number
  customerCode?: string
  sku: string
  quantity: number
  unitPrice?: number
}

@Injectable()
export class OmsPurchaseService {
  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
  ) {}

  /** OMS 客户下单：扣余额、扣减货盘剩余、累计已售，并将库存转入客户账号 */
  async recordPurchase(input: OmsPurchaseInput) {
    if (!input || typeof input !== 'object' || typeof input.orderNo !== 'string' || !input.orderNo.trim() || input.orderNo.trim().length > 50) throw new BadRequestException('请提供有效的原采购单号，重新打开确认清单后提交')
    if (typeof input.sku !== 'string' || !input.sku.trim() || input.sku.trim().length > 30) throw new BadRequestException('请提供有效的商品SKU')
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0 || input.quantity > 2147483647) throw new BadRequestException('购买数量须为有效正整数')
    if (input.customerId != null && (!Number.isSafeInteger(input.customerId) || input.customerId <= 0)) throw new BadRequestException('请选择有效客户')
    if (input.unitPrice != null && (typeof input.unitPrice !== 'number' || billingCents(input.unitPrice) <= 0)) throw new BadRequestException('请核对有效商品报价')
    const orderNo = input.orderNo.trim(), sku = toCatalogInternalSku(input.sku), quantity = input.quantity
    const code = typeof input.customerCode === 'string' ? input.customerCode.trim().toUpperCase() : ''
    const initial = input.customerId ? await this.prisma.customer.findUnique({ where: { id: BigInt(input.customerId) } })
      : code ? await this.prisma.customer.findUnique({ where: { customerCode: code } }) : null
    if (!initial || (code && initial.customerCode !== code)) throw new NotFoundException('采购客户不存在或与原客户编码不一致')
    const same = (order: any) => {
      if (order.customerId !== initial.id || toCatalogInternalSku(order.sku) !== sku || order.quantity !== quantity || (input.unitPrice != null && billingCents(order.unitPrice) !== billingCents(input.unitPrice))) throw new ConflictException('原采购单号对应的客户、商品、数量或报价不同，请核对原请求，不能修改后重试')
    }
    let saved: any
    try {
      saved = await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM customer WHERE id = ${initial.id} FOR UPDATE`
        const existing = await tx.omsCatalogOrder.findUnique({ where: { orderNo } })
        if (existing) { same(existing);return { order: existing, idempotent: true } }
        const customer = await tx.customer.findUnique({ where: { id: initial.id } })
        if (!customer || customer.status !== 1) throw new BadRequestException('客户已停用，无法新增申购')
        const found = await this.findCatalogPricing(sku, tx)
        if (!found) throw new NotFoundException(`SKU ${sku} 不在货盘库存中`)
        await tx.$queryRaw`SELECT id FROM product_pricing WHERE id = ${found.id} FOR UPDATE`
        const pricing = await tx.productPricing.findUnique({ where: { id: found.id } })
        if (!pricing || (!pricing.visibleOnOms && pricing.pricingStatus !== 'synced')) throw new BadRequestException('商品尚未发布，请返回货盘列表重新选择')
        if (pricing.shareStatus === 'stopped' || !pricing.orderableOnOms) throw new BadRequestException('商品已停止申购或可售库存不足，请返回货盘列表重新选择')
        const remaining = remainingCatalogStock(pricing), pool = catalogStockPool(pricing)
        if (quantity > remaining) throw new BadRequestException(`SKU ${sku} 货盘剩余 ${remaining} 件，不足以购买 ${quantity} 件`)
        const unitCents = billingCents(pricing.finalPrice)
        if (unitCents <= 0 || unitCents > 999999999999) throw new BadRequestException('商品报价无效，请联系运营核对定价')
        if (input.unitPrice != null && billingCents(input.unitPrice) !== unitCents) throw new ConflictException('商品报价已变化，请刷新报价并重新确认清单；本次未扣款')
        const totalCents = unitCents * quantity
        if (!Number.isSafeInteger(totalCents) || totalCents > 99999999999999) throw new BadRequestException('申购金额超过支持范围，请分批核对')
        const before = billingCents(customer.balance)
        if (before < totalCents) throw new BadRequestException(`客户余额不足：可用 ¥${(before / 100).toFixed(2)}，需支付 ¥${(totalCents / 100).toFixed(2)}`)
        const soldQty = (pricing.soldQty || 0) + quantity
        if (!Number.isSafeInteger(pool) || !Number.isSafeInteger(soldQty) || (pricing.soldQty || 0) < 0 || soldQty > pool) throw new ConflictException('货盘可售范围已变化，请刷新库存后核对')
        const created = await tx.omsCatalogOrder.create({ data: { orderNo, customerId: customer.id, customerCode: customer.customerCode, sku, quantity, unitPrice: (unitCents / 100).toFixed(2), totalAmount: (totalCents / 100).toFixed(2), balanceBefore: (before / 100).toFixed(2), balanceAfter: ((before - totalCents) / 100).toFixed(2), pricingId: pricing.id, status: 'confirmed' } })
        const debited = await tx.customer.updateMany({ where: { id: customer.id, status: 1, balance: { gte: (totalCents / 100).toFixed(2) } }, data: { balance: { decrement: (totalCents / 100).toFixed(2) } } })
        if (debited.count !== 1) throw new ConflictException('客户余额已变化，本次申购已回滚，请核对原请求后重试')
        const charge = await this.billing.createCharge({ customerId: Number(customer.id), chargeType: 'catalog_purchase', source: 'oms', description: `货盘采购 ${sku} × ${quantity}（订单 ${orderNo}，已从余额扣款）`, amount: totalCents / 100, quantity, unitPrice: unitCents / 100, chargeDate: new Date().toISOString().slice(0, 10), bizRef: orderNo, sourceRef: sku, idempotencyKey: `catalog-purchase:${customer.id}:${orderNo}` }, tx, false)
        if (!charge.id) throw new ConflictException('采购费用保存后未能核对，请使用原采购单号重试')
        await tx.$executeRawUnsafe("UPDATE billing_charge SET status='confirmed' WHERE id=?", BigInt(charge.id))
        await tx.productPricing.update({ where: { id: pricing.id }, data: { soldQty: { increment: quantity }, ...(soldQty >= pool ? { orderableOnOms: false } : {}) } })
        await tx.customerSkuInventory.upsert({ where: { customerId_sku: { customerId: customer.id, sku } }, update: { quantity: { increment: quantity }, unitPrice: unitCents / 100, productName: pricing.productName, pricingId: pricing.id }, create: { customerId: customer.id, sku, quantity, unitPrice: unitCents / 100, productName: pricing.productName, pricingId: pricing.id } })
        await tx.productPricingHistory.create({ data: { pricingId: pricing.id, operatorRole: 'OMS', action: '客户购买', detail: `客户 ${customer.customerCode} 下单 ${orderNo}，购买 ${quantity} 件，扣款 ¥${(totalCents / 100).toFixed(2)}（余额 ¥${(before / 100).toFixed(2)} → ¥${((before - totalCents) / 100).toFixed(2)}）；已售 ${soldQty}/${pool}` } })
        await tx.syncLog.create({ data: { syncType: 'oms_catalog_purchase', targetSystem: 'ERP', referenceNo: orderNo, status: 'success', requestBody: { orderNo, customerCode: customer.customerCode, sku, quantity, quotedUnitPrice: input.unitPrice }, responseBody: { customerId: Number(customer.id), totalAmount: totalCents / 100, balanceBefore: before / 100, balanceAfter: (before - totalCents) / 100, soldQty, remainingStockQty: pool - soldQty } } })
        return { order: created, idempotent: false }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000 })
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error
      const existing = await this.prisma.omsCatalogOrder.findUnique({ where: { orderNo } })
      if (!existing) throw new ConflictException('采购编号或费用编号发生冲突，本次已回滚，请核对原采购单后重试')
      same(existing);saved = { order: existing, idempotent: true }
    }
    let syncPending = false
    try { await pushCatalogStockToOms(this.prisma, sku) } catch { syncPending = true }
    if (!await this.billing.pushCustomerBillingToOms(Number(initial.id))) syncPending = true
    const [customer, holding, pricing] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: initial.id } }),
      this.prisma.customerSkuInventory.findUnique({ where: { customerId_sku: { customerId: initial.id, sku } } }),
      saved.order.pricingId ? this.prisma.productPricing.findUnique({ where: { id: saved.order.pricingId } }) : this.findCatalogPricing(sku),
    ])
    if (!customer) throw new Error('采购已保存，当前客户资料暂未读取，请使用原采购单号核对')
    return { ...this.buildPurchaseResult(saved.order, { soldQty: pricing?.soldQty ?? 0, remainingStockQty: pricing ? remainingCatalogStock(pricing) : 0, catalogStockPool: pricing ? catalogStockPool(pricing) : 0, balanceBefore: num(saved.order.balanceBefore), balanceAfter: num(saved.order.balanceAfter), idempotent: saved.idempotent }),
      currentBalance: Number(customer.balance), holdingQuantity: holding?.quantity ?? 0, syncPending,
      ...(syncPending ? { warning: '采购、扣款与持有已保存，但货盘或账单同步未完成，请使用原采购单号重试，勿再次购买' } : { message: saved.idempotent ? '原采购已完成，本次仅核对同步，未重复扣款或增加持有' : '采购已完成，余额与持有已更新' }) }
  }

  /**
   * The product pricing table can contain both the source product row and the
   * published TKL catalog row. Always prefer the latter; an unordered
   * `findFirst(... IN [...])` may otherwise reject a valid OMS purchase after
   * selecting the unpublished source row.
   */
  private async findCatalogPricing(sku: string, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const internalSku = toCatalogInternalSku(sku)
    return await db.productPricing.findUnique({ where: { sku: internalSku } })
      ?? await db.productPricing.findFirst({ where: { sku: { in: catalogSkuLookupKeys(sku) } } })
  }

  private buildPurchaseResult(
    order: {
      id: bigint
      orderNo: string
      customerId: bigint
      customerCode: string | null
      sku: string
      quantity: number
      unitPrice: unknown
      totalAmount: unknown
      balanceBefore?: unknown
      balanceAfter?: unknown
      pricingId: bigint | null
      status: string
      createdAt: Date
    },
    extra: {
      soldQty: number
      remainingStockQty: number
      catalogStockPool: number
      balanceBefore: number | null
      balanceAfter: number | null
      idempotent: boolean
    },
  ) {
    return {
      id: Number(order.id),
      orderNo: order.orderNo,
      customerId: Number(order.customerId),
      customerCode: order.customerCode,
      sku: order.sku,
      quantity: order.quantity,
      unitPrice: num(order.unitPrice),
      totalAmount: num(order.totalAmount),
      balanceBefore: extra.balanceBefore ?? (order.balanceBefore != null ? num(order.balanceBefore) : null),
      balanceAfter: extra.balanceAfter ?? (order.balanceAfter != null ? num(order.balanceAfter) : null),
      pricingId: order.pricingId ? Number(order.pricingId) : null,
      status: order.status,
      createdAt: order.createdAt,
      soldQty: extra.soldQty,
      remainingStockQty: extra.remainingStockQty,
      catalogStockPool: extra.catalogStockPool,
      idempotent: extra.idempotent,
    }
  }
}
