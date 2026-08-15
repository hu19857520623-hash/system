import type { PrismaService } from '../../common/prisma/prisma.service'
import { toCatalogInternalSku, catalogBaseSkuFromInternal } from '../../common/catalog-customer.util'

function num(v: unknown, fallback = 0): number {
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export type InboundCatalogLine = {
  sku: string
  productName?: string
  spec?: string
  inboundQty: number
  seaFreightPerUnit?: number
  domesticFeePerUnit?: number
  costRmb?: number
}

export type SyncInboundCatalogInput = {
  inboundNo: string
  poNo?: string
  warehouseCode?: string
  lines: InboundCatalogLine[]
}

/** 入库发运时自动同步 SKU、海运费等到货盘库存 */
export async function syncCatalogFromInbound(prisma: PrismaService, input: SyncInboundCatalogInput) {
  const results: { sku: string; pricingId: number; status: string }[] = []
  const now = new Date()

  for (const line of input.lines) {
    const baseSku = String(line.sku || '').trim()
    if (!baseSku) continue
    const sku = toCatalogInternalSku(baseSku)
    const inboundQty = Math.max(0, Math.floor(num(line.inboundQty)))
    const seaFreight = Math.round(num(line.seaFreightPerUnit) * 100) / 100
    const domesticFee = Math.round(num(line.domesticFeePerUnit) * 100) / 100

    const product = await prisma.product.findUnique({ where: { sku: baseSku } })
    let row = await prisma.productPricing.findUnique({ where: { sku } })

    const marketFromDev = row?.marketPrice ? num(row.marketPrice) : 0
    let resolvedMarket = marketFromDev
    if (!resolvedMarket && product) {
      const dev = await prisma.productDev.findFirst({
        where: { OR: [{ sku: baseSku }, { productName: product.productName }] },
        orderBy: { id: 'desc' },
      })
      if (dev?.marketPrice) resolvedMarket = num(dev.marketPrice)
    }

    const baseData = {
      productName: line.productName || product?.productName || sku,
      spec: line.spec || product?.spec || undefined,
      inboundNo: input.inboundNo,
      inboundQty,
      seaFreight,
      ...(domesticFee > 0 ? { domesticFee } : {}),
      freightCallbackAt: now,
      pricingStatus: 'pending_pricing' as const,
      ...(input.poNo ? { poNo: input.poNo } : {}),
      ...(line.costRmb != null && line.costRmb > 0 ? { costRmb: line.costRmb } : {}),
      ...(resolvedMarket > 0 ? { marketPrice: resolvedMarket } : {}),
    }

    if (row) {
      row = await prisma.productPricing.update({
        where: { sku },
        data: baseData,
      })
    } else {
      row = await prisma.productPricing.create({
        data: {
          sku,
          costRmb: line.costRmb ?? (product?.costRmb != null ? num(product.costRmb) : 0),
          purchaseQty: inboundQty,
          exchangeRate: 2.5,
          ...baseData,
        },
      })
    }

    if (product && (seaFreight > 0 || domesticFee > 0)) {
      await prisma.product.update({
        where: { sku: baseSku },
        data: {
          ...(seaFreight > 0 ? { seaFreightPerUnit: seaFreight } : {}),
          ...(domesticFee > 0 ? { domesticFeePerUnit: domesticFee } : {}),
        },
      })
    }

    await prisma.productPricingHistory.create({
      data: {
        pricingId: row.id,
        operatorRole: '系统',
        action: '入库自动同步',
        detail: `入库单 ${input.inboundNo} 发运同步：入库 ${inboundQty} 件，海运 ¥${seaFreight}/件${domesticFee > 0 ? `，国内 ¥${domesticFee}/件` : ''}`,
      },
    })

    results.push({ sku, pricingId: Number(row.id), status: row.pricingStatus })
  }

  return results
}
