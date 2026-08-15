import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { tryMarkOrderableOnOms } from './oms-catalog.util'
import { OperationLogService } from '../operation-log/operation-log.service'
import { syncCatalogFromInbound, type SyncInboundCatalogInput } from './catalog-sync.util'
import {
  getOmsCatalogSkuForDisplay,
  listOmsCatalogForDisplay,
  pushCatalogStockToOms,
} from './oms-catalog-sync.util'
import { catalogStockPool, remainingCatalogStock } from './catalog-stock.util'
import { CATALOG_CUSTOMER_CODE, catalogBaseSkuFromInternal } from '../../common/catalog-customer.util'

function num(v: any, fallback = 0): number {
  if (v == null) return fallback
  return Number(v)
}

function fmtTime(d: Date | null | undefined): string {
  if (!d) return ''
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return ''
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

@Injectable()
export class PricingService {
  constructor(
    private prisma: PrismaService,
    private opLog: OperationLogService,
  ) {}

  private serialize(row: any, warehouseAvailableQty?: number) {
    const soldQty = row.soldQty ?? 0
    const catalogPool = catalogStockPool(row)
    const remainingStockQty = remainingCatalogStock(row)
    return {
      id: Number(row.id),
      sku: row.sku,
      customerCode: CATALOG_CUSTOMER_CODE,
      customerSku: catalogBaseSkuFromInternal(row.sku),
      name: row.productName,
      spec: row.spec,
      cost: num(row.costRmb),
      purchaseQty: row.purchaseQty,
      inboundQty: row.inboundQty ?? 0,
      visibleStockQty: row.visibleStockQty != null ? Number(row.visibleStockQty) : null,
      soldQty,
      remainingStockQty,
      catalogStockPool: catalogPool,
      warehouseAvailableQty: warehouseAvailableQty ?? 0,
      poNo: row.poNo,
      inboundNo: row.inboundNo,
      seaFreight: num(row.seaFreight),
      domesticFee: num(row.domesticFee),
      exchangeRate: num(row.exchangeRate),
      freightCallbackTime: fmtTime(row.freightCallbackAt),
      marketPrice: num(row.marketPrice),
      pricingLogic: row.pricingLogic || '',
      targetProfitRate: num(row.targetProfitRate),
      finalPrice: num(row.finalPrice),
      overseasDeliveryFee: num(row.overseasDeliveryFee),
      platformCommission: num(row.platformCommissionRate),
      platformDeliveryFee: num(row.platformDeliveryFee),
      pricingStatus: row.pricingStatus,
      omsSyncTime: fmtTime(row.omsSyncAt),
      visibleOnOms: Boolean(row.visibleOnOms),
      orderableOnOms: Boolean(row.orderableOnOms),
      visibleOnOmsAt: fmtTime(row.visibleOnOmsAt),
      orderableOnOmsAt: fmtTime(row.orderableOnOmsAt),
      history: (row.histories || []).map((h: any) => ({
        time: fmtTime(h.createdAt),
        role: h.operatorRole,
        action: h.action,
        detail: h.detail,
      })),
      priceRecords: (row.priceRecords || []).map((r: any) => ({
        date: fmtDate(r.createdAt),
        marketPrice: num(r.marketPrice),
        price: num(r.price),
        operator: r.operator,
        note: r.note || '',
      })),
    }
  }

  private async loadWarehouseAvailableBySku(skus: string[]) {
    if (!skus.length) return new Map<string, number>()
    const wmsCodes = (
      await this.prisma.warehouse.findMany({
        where: { warehouseType: 'wms' },
        select: { warehouseCode: true },
      })
    ).map((w) => w.warehouseCode)
    if (!wmsCodes.length) return new Map<string, number>()

    const rows = await this.prisma.inventory.findMany({
      where: { sku: { in: skus }, warehouseCode: { in: wmsCodes } },
      select: { sku: true, availableQty: true },
    })
    const map = new Map<string, number>()
    for (const row of rows) {
      map.set(row.sku, (map.get(row.sku) || 0) + row.availableQty)
    }
    return map
  }

  private async resolveMarketFromDev(productName: string, sku: string): Promise<number> {
    const dev = await this.prisma.productDev.findFirst({
      where: {
        OR: [{ productName }, { productName: { contains: productName.slice(0, 8) } }],
      },
      orderBy: { id: 'desc' },
    })
    if (dev?.marketPrice) return num(dev.marketPrice)
    const bySku = await this.prisma.product.findFirst({ where: { sku } })
    if (bySku) {
      const dev2 = await this.prisma.productDev.findFirst({
        where: { productName: bySku.productName },
        orderBy: { id: 'desc' },
      })
      if (dev2?.marketPrice) return num(dev2.marketPrice)
    }
    return 0
  }

  private async ensureMarketPrice(row: any) {
    if (num(row.marketPrice) > 0) return row
    const fromDev = await this.resolveMarketFromDev(row.productName, row.sku)
    if (!fromDev) return row
    const updated = await this.prisma.productPricing.update({
      where: { id: row.id },
      data: { marketPrice: fromDev },
      include: { histories: { orderBy: { id: 'desc' } }, priceRecords: { orderBy: { id: 'asc' } } },
    })
    return updated
  }

  private async addHistory(pricingId: bigint, role: string, action: string, detail: string) {
    await this.prisma.productPricingHistory.create({
      data: { pricingId, operatorRole: role, action, detail },
    })
  }

  async list(q: PaginationDto & { status?: string }) {
    const { page, pageSize } = getPagination(q, 50)
    const where: any = {}
    if (q.status) where.pricingStatus = q.status
    if (q.keyword) {
      where.OR = [{ sku: { contains: q.keyword } }, { productName: { contains: q.keyword } }]
    }
    const [rows, total] = await Promise.all([
      this.prisma.productPricing.findMany({
        where,
        include: { histories: { orderBy: { id: 'desc' }, take: 20 }, priceRecords: { orderBy: { id: 'asc' } } },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'desc' },
      }),
      this.prisma.productPricing.count({ where }),
    ])
    const stockMap = await this.loadWarehouseAvailableBySku(rows.map((r) => r.sku))
    return { items: rows.map((r) => this.serialize(r, stockMap.get(r.sku) || 0)), total, page, pageSize }
  }

  async detail(id: number) {
    let row = await this.prisma.productPricing.findUnique({
      where: { id: BigInt(id) },
      include: { histories: { orderBy: { id: 'desc' } }, priceRecords: { orderBy: { id: 'asc' } } },
    })
    if (!row) throw new NotFoundException('货盘库存记录不存在')
    const enriched = await this.ensureMarketPrice(row)
    const stockMap = await this.loadWarehouseAvailableBySku([enriched.sku])
    return this.serialize(enriched, stockMap.get(enriched.sku) || 0)
  }

  /** 入库发运创建时自动同步货盘库存（海运费、入库数量等） */
  async syncFromInbound(input: SyncInboundCatalogInput) {
    return syncCatalogFromInbound(this.prisma, input)
  }

  async create(data: any) {
    return this.prisma.productPricing.create({
      data: {
        sku: data.sku,
        productName: data.productName || data.name,
        spec: data.spec,
        costRmb: data.costRmb ?? data.cost ?? 0,
        purchaseQty: data.purchaseQty ?? 0,
        poNo: data.poNo,
        pricingStatus: 'waiting_freight',
        exchangeRate: data.exchangeRate ?? 2.5,
      },
    })
  }

  async freightCallback(id: number, role: string, body?: any) {
    const row = await this.prisma.productPricing.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('???????')
    if (row.pricingStatus !== 'waiting_freight') throw new BadRequestException('???????????')

    const seaFreight = body?.seaFreight ?? (num(row.seaFreight) || num(row.costRmb) * 0.1)
    const domesticFee = body?.domesticFee ?? (num(row.domesticFee) || num(row.costRmb) * 0.04)
    const inboundNo = body?.inboundNo || `WH-${Date.now().toString().slice(-8)}`
    const marketFromDev = await this.resolveMarketFromDev(row.productName, row.sku)

    await this.prisma.productPricing.update({
      where: { id: BigInt(id) },
      data: {
        seaFreight,
        domesticFee,
        inboundNo,
        freightCallbackAt: new Date(),
        pricingStatus: 'pending_pricing',
        ...(marketFromDev && !num(row.marketPrice) ? { marketPrice: marketFromDev } : {}),
      },
    })

    const product = await this.prisma.product.findUnique({ where: { sku: row.sku } })
    if (product) {
      await this.prisma.product.update({
        where: { sku: row.sku },
        data: {
          seaFreightPerUnit: seaFreight,
          domesticFeePerUnit: domesticFee,
        },
      })
      await this.opLog.log({
        module: 'product',
        action: 'freight_sync',
        targetType: 'product',
        targetId: row.sku,
        detail: {
          message: `入库单 ${inboundNo} 海运费回传：海运 ¥${seaFreight}/件，国内 ¥${domesticFee}/件`,
          inboundNo,
          seaFreightPerUnit: seaFreight,
          domesticFeePerUnit: domesticFee,
        },
      })
    }

    await this.addHistory(
      BigInt(id),
      role,
      '海运费回传',
      `入库单 ${inboundNo} 回传完成，海运费 ¥${seaFreight}/件，国内费用 ¥${domesticFee}/件`,
    )
    return this.detail(id)
  }

  async confirmPrice(id: number, data: any, role: string) {
    const row = await this.prisma.productPricing.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('货盘库存记录不存在')
    if (row.pricingStatus !== 'pending_pricing') throw new BadRequestException('当前状态不可定价')

    const visibleStockQty = data.visibleStockQty != null && data.visibleStockQty !== ''
      ? Math.max(0, Math.floor(Number(data.visibleStockQty)))
      : (row.inboundQty > 0 ? row.inboundQty : row.purchaseQty)

    await this.prisma.productPricing.update({
      where: { id: BigInt(id) },
      data: {
        marketPrice: data.marketPrice,
        pricingLogic: data.pricingLogic,
        targetProfitRate: data.targetProfitRate,
        finalPrice: data.finalPrice,
        visibleStockQty,
        overseasDeliveryFee: data.overseasDeliveryFee ?? row.overseasDeliveryFee ?? 0,
        platformCommissionRate: data.platformCommission ?? row.platformCommissionRate ?? 0,
        platformDeliveryFee: data.platformDeliveryFee ?? row.platformDeliveryFee ?? 0,
        pricingStatus: 'priced',
      },
    })
    await this.addHistory(
      BigInt(id),
      role,
      '确认定价',
      `市场参考 R${data.marketPrice}，最终售价 ¥${data.finalPrice}（${data.pricingLogic || '—'}）；对客户可见库存 ${visibleStockQty} 件`,
    )
    return this.detail(id)
  }

  async syncOms(id: number, role: string) {
    const row = await this.prisma.productPricing.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('???????')
    if (row.pricingStatus !== 'priced' && row.pricingStatus !== 'synced') {
      throw new BadRequestException('???????? OMS')
    }

    const isFirst = row.pricingStatus === 'priced'
    const now = new Date()
    await this.prisma.productPricing.update({
      where: { id: BigInt(id) },
      data: {
        pricingStatus: 'synced',
        omsSyncAt: now,
        visibleOnOms: true,
        visibleOnOmsAt: row.visibleOnOmsAt ?? now,
      },
    })
    await this.prisma.product.updateMany({
      where: { sku: row.sku },
      data: { syncStatus: 'synced' },
    })
    if (isFirst) {
      await this.prisma.productPriceRecord.create({
        data: {
          pricingId: BigInt(id),
          marketPrice: row.marketPrice ?? 0,
          price: row.finalPrice ?? 0,
          operator: role,
          note: '首次同步 OMS',
        },
      })
      await this.addHistory(
        BigInt(id),
        role,
        '同步 OMS',
        `售价 ¥${num(row.finalPrice)} 已同步至 OMS，剩余库存 ${remainingCatalogStock(row)} 件（可见 ${row.visibleStockQty ?? row.inboundQty ?? 0} 件，已售 ${row.soldQty ?? 0} 件）`,
      )
    }
    await tryMarkOrderableOnOms(this.prisma, row.sku)
    const refreshed = await this.prisma.productPricing.findUnique({ where: { id: BigInt(id) } })
    if (refreshed) await pushCatalogStockToOms(this.prisma, refreshed.sku)
    return this.detail(id)
  }

  async listOmsCatalogForOms() {
    const items = await listOmsCatalogForDisplay(this.prisma)
    return { items, total: items.length, syncedAt: new Date().toISOString() }
  }

  async getOmsCatalogSkuForOms(sku: string) {
    const item = await getOmsCatalogSkuForDisplay(this.prisma, sku.trim())
    if (!item) throw new NotFoundException(`SKU ${sku} 未在 OMS 货盘展示`)
    return item
  }

  async reprice(id: number, data: any, role: string) {
    const row = await this.prisma.productPricing.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('???????')
    if (row.pricingStatus !== 'synced') throw new BadRequestException('?????????')

    const oldPrice = num(row.finalPrice)
    await this.prisma.productPricing.update({
      where: { id: BigInt(id) },
      data: {
        marketPrice: data.marketPrice,
        finalPrice: data.price ?? data.finalPrice,
        overseasDeliveryFee: data.overseasDeliveryFee ?? row.overseasDeliveryFee ?? 0,
        platformCommissionRate: data.platformCommission ?? row.platformCommissionRate ?? 0,
        platformDeliveryFee: data.platformDeliveryFee ?? row.platformDeliveryFee ?? 0,
        omsSyncAt: new Date(),
      },
    })
    await this.prisma.productPriceRecord.create({
      data: {
        pricingId: BigInt(id),
        marketPrice: data.marketPrice,
        price: data.price ?? data.finalPrice,
        operator: role,
        note: data.note || '????',
      },
    })
    await this.addHistory(
      BigInt(id),
      role,
      '调价同步',
      `市场参考 R${data.marketPrice}，售价 ¥${oldPrice} → ¥${data.price ?? data.finalPrice}`,
    )
    await pushCatalogStockToOms(this.prisma, row.sku)
    return this.detail(id)
  }
}
