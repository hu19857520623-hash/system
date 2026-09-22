import type { PrismaService } from '../../common/prisma/prisma.service'
import { catalogSkuLookupKeys, toCatalogInternalSku } from '../../common/catalog-customer.util'
import { receivedCatalogQtyPatch } from './catalog-stock.util'
import { pushCatalogStockToOms } from './oms-catalog-sync.util'

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

export type InboundActualCatalogLine = {
  sku: string
  actualQty: number
}

/** 入库完结后按实收回写货盘本批入库（只改本单对应的货盘行） */
export async function applyInboundActualToCatalog(
  prisma: PrismaService,
  input: { inboundNo: string; lines: InboundActualCatalogLine[] },
) {
  const results: { sku: string; pricingId: number; inboundQty: number; changed: boolean }[] = []

  for (const line of input.lines) {
    const baseSku = String(line.sku || '').trim()
    if (!baseSku) continue
    const keys = catalogSkuLookupKeys(baseSku)
    const row = await prisma.productPricing.findFirst({ where: { sku: { in: keys } } })
    if (!row) continue
    if (row.inboundNo && row.inboundNo !== input.inboundNo) continue

    const actualQty = Math.max(0, Math.floor(num(line.actualQty)))
    const patch = receivedCatalogQtyPatch(row, actualQty)
    if (!patch) {
      results.push({ sku: row.sku, pricingId: Number(row.id), inboundQty: Number(row.inboundQty ?? 0), changed: false })
      continue
    }

    const updated = await prisma.productPricing.update({
      where: { id: row.id },
      data: patch,
    })

    const visibleNote = patch.visibleStockQty != null
      ? `，可见库存 ${row.visibleStockQty} → ${patch.visibleStockQty}`
      : ''
    await prisma.productPricingHistory.create({
      data: {
        pricingId: updated.id,
        operatorRole: '系统',
        action: '入库实收回写',
        detail: `入库单 ${input.inboundNo} 实收 ${actualQty} 件，本批入库 ${row.inboundQty ?? 0} → ${actualQty}${visibleNote}`,
      },
    })

    if (updated.visibleOnOms) {
      try {
        await pushCatalogStockToOms(prisma, updated.sku)
      } catch (err) {
        console.warn('[catalog] OMS stock push after inbound actual skipped:', err)
      }
    }

    results.push({ sku: updated.sku, pricingId: Number(updated.id), inboundQty: actualQty, changed: true })
  }

  return results
}

/** 货盘列表/详情自愈：已完结入库单仍挂着 ASN 数量时，按实收回写 */
export async function reconcileCatalogFromCompletedInbounds<
  T extends {
    sku: string
    inboundNo?: string | null
    inboundQty?: number | null
    visibleStockQty?: number | null
  },
>(prisma: PrismaService, rows: T[]): Promise<T[]> {
  const nos = [...new Set(rows.map((r) => r.inboundNo).filter(Boolean))] as string[]
  if (!nos.length) return rows
  const orders = await prisma.inboundOrder.findMany({
    where: { inboundNo: { in: nos }, status: { in: ['completed', 'confirmed'] } },
    include: { items: true },
  })
  if (!orders.length) return rows

  const orderByNo = new Map(orders.map((o) => [o.inboundNo, o]))
  const out = [...rows]
  for (let i = 0; i < out.length; i++) {
    const row = out[i]
    if (!row.inboundNo) continue
    const order = orderByNo.get(row.inboundNo)
    if (!order) continue
    const catalogKeys = new Set(catalogSkuLookupKeys(row.sku))
    const matched = order.items.filter((it) => catalogSkuLookupKeys(it.sku).some((k) => catalogKeys.has(k)))
    if (!matched.length) continue
    const actualQty = matched.reduce((sum, it) => sum + Math.max(0, Number(it.actualQty ?? 0)), 0)
    const applied = await applyInboundActualToCatalog(prisma, {
      inboundNo: row.inboundNo,
      lines: [{ sku: row.sku, actualQty }],
    })
    const changed = applied.find((r) => r.changed)
    if (!changed) continue
    out[i] = {
      ...row,
      inboundQty: changed.inboundQty,
      ...(row.visibleStockQty != null && Number(row.visibleStockQty) > actualQty
        ? { visibleStockQty: actualQty }
        : {}),
    }
  }
  return out
}
