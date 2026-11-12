import { BadRequestException, NotFoundException } from '@nestjs/common'
import { billingCents } from '../billing/billing-workflow.util'
export const CATALOG_PRICE_TIERS = ['A', 'B', 'C', 'D'] as const
export type CatalogPriceTier = typeof CATALOG_PRICE_TIERS[number]
export function catalogPriceTier(value: unknown = 'A'): CatalogPriceTier {
  if (!CATALOG_PRICE_TIERS.includes(value as any)) throw new BadRequestException('请选择有效的货盘价格档位 A、B、C 或 D')
  return value as CatalogPriceTier
}
export function catalogPrices(row: { finalPrice?: unknown; priceB?: unknown; priceC?: unknown; priceD?: unknown }) {
  const value = (v: unknown) => v == null ? null : Number(v)
  return { A: value(row.finalPrice), B: value(row.priceB), C: value(row.priceC), D: value(row.priceD) }
}
export function catalogUnitPrice(row: Parameters<typeof catalogPrices>[0], tier: unknown = 'A'): number | null {
  const t = catalogPriceTier(tier), price = catalogPrices(row)[t]
  return price != null && Number.isFinite(price) && price > 0 ? price : null
}
export async function customerCatalogTier(db: any, code?: string): Promise<CatalogPriceTier> {
  if (code === undefined) return 'A' // Internal unscoped/admin catalog only.
  if (typeof code !== 'string' || !code.trim()) throw new BadRequestException('缺少货盘报价客户，请重新选择客户')
  const c = await db.customer.findUnique({ where: { customerCode: code.trim().toUpperCase() } })
  if (!c || c.status !== 1) throw new NotFoundException('货盘报价客户不存在或已停用')
  return catalogPriceTier(c.catalogPriceTier ?? 'A')
}
export function validateCatalogPrices(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('') !== 'ABCD') throw new BadRequestException('请完整提交四档商品价格')
  for (const tier of CATALOG_PRICE_TIERS) {
    const price = value[tier]
    if (tier !== 'A' && price === null) continue
    if (typeof price !== 'number' || !Number.isFinite(price) || billingCents(price) <= 0 || billingCents(price) > 999999999999) throw new BadRequestException(`${tier} 档售价须大于零且最多两位小数；未定价的 B/C/D 档请留空`)
  }
  return value as Record<CatalogPriceTier, number | null>
}
