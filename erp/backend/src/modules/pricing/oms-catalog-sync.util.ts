import type { PrismaService } from '../../common/prisma/prisma.service'
import { catalogStockPool, remainingCatalogStock } from './catalog-stock.util'
import { CATALOG_CUSTOMER_CODE, catalogBaseSkuFromInternal } from '../../common/catalog-customer.util'

function num(v: unknown, fallback = 0): number {
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export type OmsCatalogStockPayload = {
  sku: string
  customerCode: string
  customerSku: string
  productName: string
  spec: string | null
  lengthCm: number
  widthCm: number
  heightCm: number
  weightKg: number
  dimensionsSource: 'measured' | 'master' | null
  price: number
  catalogStockPool: number
  soldQty: number
  remainingStockQty: number
  visibleOnOms: boolean
  orderableOnOms: boolean
  syncedAt: string
}

export function buildOmsCatalogPayload(pricing: {
  sku: string
  productName: string
  spec?: string | null
  finalPrice?: unknown
  visibleStockQty?: number | null
  inboundQty?: number | null
  purchaseQty?: number | null
  soldQty?: number | null
  visibleOnOms?: boolean
  orderableOnOms?: boolean
  lengthCm?: unknown
  widthCm?: unknown
  heightCm?: unknown
  weightKg?: unknown
  dimensionsSource?: 'measured' | 'master' | null
}): OmsCatalogStockPayload {
  return {
    sku: pricing.sku,
    customerCode: CATALOG_CUSTOMER_CODE,
    customerSku: catalogBaseSkuFromInternal(pricing.sku),
    productName: pricing.productName,
    spec: pricing.spec ?? null,
    lengthCm: num(pricing.lengthCm),
    widthCm: num(pricing.widthCm),
    heightCm: num(pricing.heightCm),
    weightKg: num(pricing.weightKg),
    dimensionsSource: pricing.dimensionsSource ?? null,
    price: num(pricing.finalPrice),
    catalogStockPool: catalogStockPool(pricing),
    soldQty: pricing.soldQty ?? 0,
    remainingStockQty: remainingCatalogStock(pricing),
    visibleOnOms: Boolean(pricing.visibleOnOms),
    orderableOnOms: Boolean(pricing.orderableOnOms),
    syncedAt: new Date().toISOString(),
  }
}

function mergeProductDimensions<
  T extends {
    sku: string
    spec?: string | null
  },
>(
  pricing: T,
  product?: {
    spec: string | null
    lengthCm: unknown
    widthCm: unknown
    heightCm: unknown
    weightKg: unknown
    measuredLengthCm: unknown
    measuredWidthCm: unknown
    measuredHeightCm: unknown
  } | null,
) {
  const hasMeasured =
    num(product?.measuredLengthCm) > 0 &&
    num(product?.measuredWidthCm) > 0 &&
    num(product?.measuredHeightCm) > 0
  return {
    ...pricing,
    spec: pricing.spec ?? product?.spec ?? null,
    lengthCm: hasMeasured ? product?.measuredLengthCm : product?.lengthCm,
    widthCm: hasMeasured ? product?.measuredWidthCm : product?.widthCm,
    heightCm: hasMeasured ? product?.measuredHeightCm : product?.heightCm,
    weightKg: product?.weightKg,
    dimensionsSource: hasMeasured ? 'measured' as const : product ? 'master' as const : null,
  }
}

/** 推送货盘剩余库存至 OMS 展示层（写入 sync_log，供 OMS 拉取或对接） */
export async function pushCatalogStockToOms(
  prisma: PrismaService,
  sku: string,
): Promise<OmsCatalogStockPayload | null> {
  const pricing = await prisma.productPricing.findUnique({ where: { sku } })
  if (!pricing?.visibleOnOms) return null
  const product = await prisma.product.findUnique({ where: { sku } })

  const payload = buildOmsCatalogPayload(mergeProductDimensions(pricing, product))
  await prisma.syncLog.create({
    data: {
      syncType: 'oms_catalog_stock',
      targetSystem: 'OMS',
      referenceNo: sku,
      status: 'success',
      requestBody: payload as object,
      responseBody: { ok: true, message: '货盘剩余库存已推送至 OMS 展示层' },
    },
  })
  return payload
}

/** OMS 展示层拉取货盘列表（含剩余库存） */
export async function listOmsCatalogForDisplay(prisma: PrismaService): Promise<OmsCatalogStockPayload[]> {
  const rows = await prisma.productPricing.findMany({
    where: { visibleOnOms: true },
    orderBy: { id: 'desc' },
  })
  const products = rows.length
    ? await prisma.product.findMany({ where: { sku: { in: rows.map(row => row.sku) } } })
    : []
  const productBySku = new Map(products.map(product => [product.sku, product]))
  return rows.map(row => buildOmsCatalogPayload(mergeProductDimensions(row, productBySku.get(row.sku))))
}

export async function getOmsCatalogSkuForDisplay(
  prisma: PrismaService,
  sku: string,
): Promise<OmsCatalogStockPayload | null> {
  const pricing = await prisma.productPricing.findUnique({ where: { sku } })
  if (!pricing?.visibleOnOms) return null
  const product = await prisma.product.findUnique({ where: { sku } })
  return buildOmsCatalogPayload(mergeProductDimensions(pricing, product))
}
