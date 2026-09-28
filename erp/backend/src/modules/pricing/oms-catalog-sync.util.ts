import type { PrismaService } from '../../common/prisma/prisma.service'
import { catalogStockPool, remainingCatalogStock } from './catalog-stock.util'
import { CATALOG_CUSTOMER_CODE, catalogBaseSkuFromInternal, catalogSkuLookupKeys } from '../../common/catalog-customer.util'

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
  imageUrl: string | null
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
  shareStatus: 'enabled' | 'stopped'
  syncedAt: string
}

export function buildOmsCatalogPayload(pricing: {
  sku: string
  productName: string
  imageUrl?: string | null
  spec?: string | null
  finalPrice?: unknown
  visibleStockQty?: number | null
  inboundQty?: number | null
  purchaseQty?: number | null
  soldQty?: number | null
  visibleOnOms?: boolean
  pricingStatus?: string | null
  orderableOnOms?: boolean
  shareStatus?: string | null
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
    imageUrl: pricing.imageUrl || null,
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
    // Older OMS syncs recorded `pricingStatus = synced` but predate the
    // visibleOnOms flag. Treat those rows as published as well so they are not
    // silently hidden from the OMS catalog.
    visibleOnOms: Boolean(pricing.visibleOnOms) || pricing.pricingStatus === 'synced',
    orderableOnOms: Boolean(pricing.orderableOnOms),
    shareStatus: pricing.shareStatus === 'stopped' ? 'stopped' : 'enabled',
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
    id: bigint
    spec: string | null
    imageUrl: string | null
    images?: Array<{ imageUrl: string }>
    lengthCm: unknown
    widthCm: unknown
    heightCm: unknown
    weightKg: unknown
    measuredLengthCm: unknown
    measuredWidthCm: unknown
    measuredHeightCm: unknown
  } | null,
  resolveImageUrl: (url: string) => string = (url) => url,
) {
  const hasMeasured =
    num(product?.measuredLengthCm) > 0 &&
    num(product?.measuredWidthCm) > 0 &&
    num(product?.measuredHeightCm) > 0
  return {
    ...pricing,
    imageUrl: (() => {
      const raw = product?.images?.[0]?.imageUrl || product?.imageUrl || ''
      return raw ? resolveImageUrl(raw) || null : null
    })(),
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
  const pricing = await prisma.productPricing.findFirst({ where: { sku: { in: catalogSkuLookupKeys(sku) } } })
  if (!pricing?.visibleOnOms) return null
  const product = await prisma.product.findFirst({ where: { sku: { in: catalogSkuLookupKeys(sku) } } })

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
export async function listOmsCatalogForDisplay(
  prisma: PrismaService,
  resolveImageUrl: (url: string) => string = (url) => url,
): Promise<OmsCatalogStockPayload[]> {
  const rows = await prisma.productPricing.findMany({
    where: {
      OR: [
        { visibleOnOms: true },
        { pricingStatus: 'synced' },
      ],
    },
    orderBy: { id: 'desc' },
  })
  const products = rows.length
      ? await prisma.product.findMany({
        where: { sku: { in: [...new Set(rows.flatMap((row) => catalogSkuLookupKeys(row.sku)))] } },
        include: {
          images: {
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            take: 1,
            select: { imageUrl: true },
          },
        },
      })
    : []
  const productBySku = new Map(products.map(product => [product.sku, product]))
  return rows.map(row => {
    const product = catalogSkuLookupKeys(row.sku).map((key) => productBySku.get(key)).find(Boolean)
    return buildOmsCatalogPayload(mergeProductDimensions(row, product, resolveImageUrl))
  })
}

export async function getOmsCatalogSkuForDisplay(
  prisma: PrismaService,
  sku: string,
  resolveImageUrl: (url: string) => string = (url) => url,
): Promise<OmsCatalogStockPayload | null> {
  const pricing = await prisma.productPricing.findFirst({ where: { sku: { in: catalogSkuLookupKeys(sku) } } })
  if (!pricing || (!pricing.visibleOnOms && pricing.pricingStatus !== 'synced')) return null
  const product = await prisma.product.findFirst({
    where: { sku: { in: catalogSkuLookupKeys(sku) } },
    include: {
      images: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { imageUrl: true },
      },
    },
  })
  return buildOmsCatalogPayload(mergeProductDimensions(pricing, product, resolveImageUrl))
}
