import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { catalogPrices, catalogPriceTier, validateCatalogPrices } from './catalog-price.util'
export async function setCatalogPrices(prisma: any, id: number, data: any, actor: number) {
  const prices = validateCatalogPrices(data?.prices), expected = data?.expectedPrices
  if (!expected || typeof expected !== 'object') throw new BadRequestException('请先读取最新价格再保存')
  const remark = typeof data.remark === 'string' ? data.remark.trim() : ''
  if (!remark || remark.length > 500) throw new BadRequestException('请填写调价原因，最多500字')
  return prisma.$transaction(async (tx: any) => {
    await tx.$queryRaw`SELECT id FROM product_pricing WHERE id = ${BigInt(id)} FOR UPDATE`
    const row = await tx.productPricing.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('货盘商品不存在')
    if (!['priced','synced'].includes(row.pricingStatus)) throw new BadRequestException('请先完成商品基础定价，再设置四档价格')
    const before = catalogPrices(row)
    if (Object.keys(before).some(t => before[t] !== expected[t])) throw new ConflictException('商品价格已变化，请刷新后重新核对')
    await tx.productPricing.update({ where: { id: row.id }, data: { finalPrice: prices.A, priceB: prices.B, priceC: prices.C, priceD: prices.D } })
    await tx.productPricingHistory.create({ data: { pricingId: row.id, operatorRole: `操作人 ${actor}`, action: '四档价格调整', detail: JSON.stringify({ before, after: prices, remark }) } })
    if (row.pricingStatus === 'synced' && before.A !== prices.A) await tx.productPriceRecord.create({ data: { pricingId: row.id, marketPrice: row.marketPrice ?? 0, price: prices.A!, operator: String(actor), note: remark } })
    return { id, prices }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000 })
}
export async function setCustomerCatalogTier(prisma: any, id: number, data: any, actor: number) {
  if (data?.tier === undefined || data?.expectedTier === undefined) throw new BadRequestException('请完整提交客户档位与原档位')
  const tier = catalogPriceTier(data?.tier), expectedTier = catalogPriceTier(data?.expectedTier)
  return prisma.$transaction(async (tx: any) => {
    await tx.$queryRaw`SELECT id FROM customer WHERE id = ${BigInt(id)} FOR UPDATE`
    const customer = await tx.customer.findUnique({ where: { id: BigInt(id) } })
    if (!customer) throw new NotFoundException('客户不存在')
    const before = catalogPriceTier(customer.catalogPriceTier ?? 'A')
    if (before !== expectedTier) throw new ConflictException('客户价格档位已变化，请刷新后重新设置')
    await tx.customer.update({ where: { id: customer.id }, data: { catalogPriceTier: tier } })
    await tx.operationLog.create({ data: { module: 'customers', action: 'catalog_price_tier', operatorId: BigInt(actor), targetType: 'customer', targetId: String(id), detail: { customerCode: customer.customerCode, before, after: tier } } })
    return { id, catalogPriceTier: tier }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000 })
}
