import type { PrismaService } from '../../common/prisma/prisma.service'
import { remainingCatalogStock } from './catalog-stock.util'
import { pushCatalogStockToOms } from './oms-catalog-sync.util'
import { catalogBaseSkuFromInternal } from '../../common/catalog-customer.util'

/** 海外仓有可用库存、货盘已对 OMS 可见且仍有可售剩余时，标记为可下单 */
export async function tryMarkOrderableOnOms(prisma: PrismaService, sku: string): Promise<boolean> {
  const pricing = await prisma.productPricing.findUnique({ where: { sku } })
  if (!pricing?.visibleOnOms || pricing.orderableOnOms) return Boolean(pricing?.orderableOnOms)

  if (remainingCatalogStock(pricing) <= 0) return false

  const product = await prisma.product.findUnique({
    where: { sku: catalogBaseSkuFromInternal(sku) },
    select: { id: true },
  })
  if (!product) return false

  const wmsCodes = (
    await prisma.warehouse.findMany({
      where: { warehouseType: 'wms' },
      select: { warehouseCode: true },
    })
  ).map((w) => w.warehouseCode)

  if (!wmsCodes.length) return false

  const inv = await prisma.inventory.findFirst({
    where: {
      productId: product.id,
      warehouseCode: { in: wmsCodes },
      availableQty: { gt: 0 },
    },
  })
  if (!inv) return false

  const now = new Date()
  await prisma.productPricing.update({
    where: { sku },
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
