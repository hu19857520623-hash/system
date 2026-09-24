import type { PrismaService } from '../../common/prisma/prisma.service'
import { remainingCatalogStock } from './catalog-stock.util'
import { pushCatalogStockToOms } from './oms-catalog-sync.util'
import { catalogSkuLookupKeys, toCatalogInternalSku } from '../../common/catalog-customer.util'

/** 海外仓有可用库存、货盘已对 OMS 可见且仍有可售剩余时，标记为可下单 */
export async function tryMarkOrderableOnOms(prisma: PrismaService, sku: string): Promise<boolean> {
  // 货盘 SKU 与基础商品 SKU 可能同时存在于 product_pricing。必须优先取 TKL- 货盘行，
  // 否则 findFirst 可能命中未上架的基础行，导致已有海外仓库存仍停留在“可见”。
  const internalSku = toCatalogInternalSku(sku)
  const pricing = await prisma.productPricing.findUnique({ where: { sku: internalSku } })
    ?? await prisma.productPricing.findFirst({ where: { sku: { in: catalogSkuLookupKeys(sku) } } })
  // 人工停止共享优先级高于库存自动开售，补货或重新查询均不得把它重新打开。
  if (pricing?.shareStatus === 'stopped') return false
  if (!pricing?.visibleOnOms || pricing.orderableOnOms) return Boolean(pricing?.orderableOnOms)

  if (remainingCatalogStock(pricing) <= 0) return false

  const wmsCodes = (
    await prisma.warehouse.findMany({
      where: { warehouseType: 'wms' },
      select: { warehouseCode: true },
    })
  ).map((w) => w.warehouseCode)

  if (!wmsCodes.length) return false

  const skuKeys = catalogSkuLookupKeys(sku)
  const inv = await prisma.inventory.findFirst({
    where: {
      sku: { in: skuKeys },
      warehouseCode: { in: wmsCodes },
      availableQty: { gt: 0 },
    },
  })
  if (!inv) return false

  const now = new Date()
  await prisma.productPricing.update({
    where: { sku: pricing.sku },
    data: { orderableOnOms: true, orderableOnOmsAt: now },
  })
  await prisma.productPricingHistory.create({
    data: {
      pricingId: pricing.id,
      operatorRole: 'system',
      action: '开放下单',
      detail: `海外仓 ${inv.warehouseCode} 可用库存 ${inv.availableQty}，OMS 货盘开放下单`,
    },
  })
  await pushCatalogStockToOms(prisma, sku)
  return true
}

export async function tryMarkOrderableOnOmsForSkus(prisma: PrismaService, skus: string[]) {
  const unique = [...new Set(skus.filter(Boolean))]
  for (const sku of unique) {
    await tryMarkOrderableOnOms(prisma, sku)
  }
}
