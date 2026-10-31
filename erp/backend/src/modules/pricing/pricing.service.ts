import { createHash } from 'node:crypto'
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { billingCents } from '../billing/billing-workflow.util'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { tryMarkOrderableOnOms } from './oms-catalog.util'
import { OperationLogService } from '../operation-log/operation-log.service'
import {
  applyInboundActualToCatalog,
  applyInboundSeaFreightToCatalog,
  reconcileCatalogFromCompletedInbounds,
  syncCatalogFromInbound,
  type SyncInboundCatalogInput,
} from './catalog-sync.util'
import {
  getOmsCatalogSkuForDisplay,
  listOmsCatalogForDisplay,
  pushCatalogStockToOms,
} from './oms-catalog-sync.util'
import { catalogStockPool, remainingCatalogStock } from './catalog-stock.util'
import { withCatalogReceiptCaps } from './catalog-receipts.util'
import { setCatalogVisibility } from './catalog-visibility.util'
import type { CatalogVisibilityDto } from './dto/catalog-visibility.dto'
import {
  addQtyForCatalogSku,
  buildCatalogSkuIndex,
  CATALOG_INBOUND_CANCELLED_STATUSES,
  CATALOG_PO_EXCLUDED_STATUSES,
  catalogInTransitQty,
  emptyCatalogPipelineQty,
  finishCatalogPipelineQty,
  openInboundRemaining,
  type CatalogPipelineQty,
} from './catalog-pipeline-qty.util'
import { CATALOG_CUSTOMER_CODE, catalogBaseSkuFromInternal, catalogSkuLookupKeys, toCatalogInternalSku } from '../../common/catalog-customer.util'
import { CosObjectUrlService } from '../../common/cos-object-url.service'
import { assertGlobalSkuAvailable } from '../../common/global-sku.util'
import { readableDisplayText } from '../../common/display-text.util'

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
    private cosUrls: CosObjectUrlService,
  ) {}

  private serialize(row: any, warehouseAvailableQty?: number, pipeline?: CatalogPipelineQty) {
    const soldQty = row.soldQty ?? 0
    const catalogPool = catalogStockPool(row)
    const remainingStockQty = remainingCatalogStock(row)
    const purchaseQty = (pipeline?.purchaseQty || 0) > 0 ? pipeline!.purchaseQty : (row.purchaseQty || 0)
    const inTransitQty = pipeline?.inTransitQty ?? catalogInTransitQty({
      purchaseTotal: purchaseQty,
      inboundExpectedTotal: pipeline?.inboundExpectedTotal ?? 0,
      openInboundRemaining: pipeline?.openInboundRemaining ?? 0,
    })
    return {
      id: Number(row.id),
      updatedAt: row.updatedAt,
      sku: row.sku,
      customerCode: CATALOG_CUSTOMER_CODE,
      customerSku: catalogBaseSkuFromInternal(row.sku),
      name: row.productName,
      spec: row.spec,
      cost: num(row.costRmb),
      purchaseQty,
      inboundQty: row.inboundQty ?? 0,
      receivedGoodQty: row.receivedGoodQty ?? 0,
      visibleStockQty: row.visibleStockQty != null ? Number(row.visibleStockQty) : null,
      soldQty,
      remainingStockQty,
      inTransitQty,
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
      orderableOnOms: Boolean(row.orderableOnOms) && row.shareStatus !== 'stopped' && remainingStockQty > 0,
      shareStatus: row.shareStatus === 'stopped' ? 'stopped' : 'enabled',
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
        note: readableDisplayText(r.note, '手动调价'),
      })),
    }
  }

  private async loadCatalogHoldersBySku(skus: string[]) {
    if (!skus.length) return new Map<string, { customerCode: string; customerName: string; quantity: number }[]>()
    const lookup = [...new Set(skus.flatMap((sku) => catalogSkuLookupKeys(sku)))]
    const rows = await this.prisma.customerSkuInventory.findMany({
      where: { sku: { in: lookup }, quantity: { gt: 0 } },
      select: { sku: true, quantity: true, customerId: true },
    })
    if (!rows.length) return new Map()

    const customers = await this.prisma.customer.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.customerId))] } },
      select: { id: true, customerCode: true, customerName: true },
    })
    const customerMap = new Map(customers.map((c) => [Number(c.id), c]))
    const map = new Map<string, { customerCode: string; customerName: string; quantity: number }[]>()
    const holdersByLookupSku = new Map<string, { customerCode: string; customerName: string; quantity: number }[]>()

    for (const row of rows) {
      const customer = customerMap.get(Number(row.customerId))
      if (!customer) continue
      const list = holdersByLookupSku.get(row.sku) || []
      list.push({
        customerCode: customer.customerCode,
        customerName: readableDisplayText(customer.customerName, customer.customerCode),
        quantity: row.quantity,
      })
      holdersByLookupSku.set(row.sku, list)
    }
    for (const sku of skus) {
      const merged: { customerCode: string; customerName: string; quantity: number }[] = []
      for (const key of catalogSkuLookupKeys(sku)) {
        merged.push(...(holdersByLookupSku.get(key) || []))
      }
      merged.sort((a, b) => b.quantity - a.quantity)
      map.set(sku, merged)
    }
    return map
  }

  private attachHolderFields<T extends { sku: string }>(
    row: T,
    holdersMap: Map<string, { customerCode: string; customerName: string; quantity: number }[]>,
  ) {
    const holders = holdersMap.get(row.sku) || []
    return {
      ...row,
      holders,
      holderCount: holders.length,
      holderSummary: holders.length
        ? holders.map((h) => `${h.customerCode}(${h.quantity})`).join('、')
        : '',
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

    const lookup = [...new Set(skus.flatMap((sku) => catalogSkuLookupKeys(sku)))]
    const rows = await this.prisma.inventory.findMany({
      where: { sku: { in: lookup }, warehouseCode: { in: wmsCodes } },
      select: { sku: true, availableQty: true },
    })
    const invBySku = new Map<string, number>()
    for (const row of rows) {
      invBySku.set(row.sku, (invBySku.get(row.sku) || 0) + row.availableQty)
    }
    const map = new Map<string, number>()
    for (const sku of skus) {
      let qty = 0
      for (const key of catalogSkuLookupKeys(sku)) qty += invBySku.get(key) || 0
      map.set(sku, qty)
    }
    return map
  }

  /** 货盘采购合计 / 在途：按全部采购单与未完结入库单现算，不覆盖写入 */
  private async loadCatalogPipelineQtyBySku(skus: string[]) {
    const map = new Map<string, CatalogPipelineQty>()
    for (const sku of skus) map.set(sku, emptyCatalogPipelineQty())
    if (!skus.length) return map

    const lookup = [...new Set(skus.flatMap((sku) => catalogSkuLookupKeys(sku)))]
    const index = buildCatalogSkuIndex(skus)
    const purchase = new Map<string, number>()
    const inboundExpected = new Map<string, number>()
    const openRemaining = new Map<string, number>()
    const damagedPurchase = new Map<string, number>()

    const [poItems, inboundItems] = await Promise.all([
      this.prisma.purchaseOrderItem.findMany({
        where: {
          sku: { in: lookup },
          order: { status: { notIn: CATALOG_PO_EXCLUDED_STATUSES } },
        },
        select: { poId: true, sku: true, quantity: true },
      }),
      this.prisma.inboundOrderItem.findMany({
        where: {
          sku: { in: lookup },
          order: { status: { notIn: CATALOG_INBOUND_CANCELLED_STATUSES } },
        },
        select: { sku: true, expectedQty: true, actualQty: true, order: { select: { status: true } } },
      }),
    ])

    // Receipt damage completes purchasing but cannot become a future usable shipment.
    // Only receipts for the same eligible purchase orders participate in this scope.
    const poIds = [...new Set(poItems.map(item => item.poId))]
    if (poIds.length) {
      const damage = await this.prisma.logisticsReceiptItem.findMany({
        where: { sku: { in: lookup }, damagedQty: { gt: 0 }, receipt: { poId: { in: poIds } } },
        select: { sku: true, damagedQty: true },
      })
      for (const item of damage) addQtyForCatalogSku(index, damagedPurchase, item.sku, item.damagedQty)
    }
    for (const item of poItems) addQtyForCatalogSku(index, purchase, item.sku, item.quantity)
    for (const item of inboundItems) {
      addQtyForCatalogSku(index, inboundExpected, item.sku, item.expectedQty)
      addQtyForCatalogSku(
        index,
        openRemaining,
        item.sku,
        openInboundRemaining(item.expectedQty, item.actualQty, item.order.status),
      )
    }

    for (const sku of skus) {
      map.set(sku, finishCatalogPipelineQty(sku, purchase, inboundExpected, openRemaining, damagedPurchase))
    }
    return map
  }

  private async resolveMarketFromDev(productName: string, sku: string): Promise<number> {
    if (sku) {
      const bySku = await this.prisma.productDev.findFirst({
        where: { sku },
        orderBy: { id: 'desc' },
      })
      if (bySku?.marketPrice) return num(bySku.marketPrice)
    }
    const dev = await this.prisma.productDev.findFirst({
      where: {
        OR: [{ productName }, { productName: { contains: productName.slice(0, 8) } }],
      },
      orderBy: { id: 'desc' },
    })
    if (dev?.marketPrice) return num(dev.marketPrice)
    const bySkuProduct = await this.prisma.product.findFirst({ where: { sku } })
    if (bySkuProduct) {
      const dev2 = await this.prisma.productDev.findFirst({
        where: { productName: bySkuProduct.productName },
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

  private async ensureOrderableIfWarehouseReady<T extends {
    sku: string
    visibleOnOms: boolean
    orderableOnOms: boolean
    shareStatus?: string | null
    visibleStockQty?: number | null
    inboundQty?: number | null
    purchaseQty?: number | null
    soldQty?: number | null
  }>(row: T, warehouseAvailableQty: number): Promise<T> {
    if (row.shareStatus !== 'stopped' && row.visibleOnOms && !row.orderableOnOms && remainingCatalogStock(row) > 0 && warehouseAvailableQty > 0) {
      if (await tryMarkOrderableOnOms(this.prisma, row.sku)) {
        return { ...row, orderableOnOms: true, orderableOnOmsAt: new Date() } as T
      }
    }
    return row
  }

  async list(q: PaginationDto & { status?: string }) {
    const { page, pageSize } = getPagination(q, 50)
    const where: any = {}
    if (q.status) where.pricingStatus = q.status
    if (q.keyword) {
      where.OR = [{ sku: { contains: q.keyword } }, { productName: { contains: q.keyword } }]
    }
    const [rawRows, total] = await Promise.all([
      this.prisma.productPricing.findMany({
        where,
        include: { histories: { orderBy: { id: 'desc' }, take: 20 }, priceRecords: { orderBy: { id: 'asc' } } },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'desc' },
      }),
      this.prisma.productPricing.count({ where }),
    ])
    const rows = await reconcileCatalogFromCompletedInbounds(this.prisma, rawRows)
    const skus = rows.map((r) => r.sku)
    const [stockMap, holdersMap, pipelineMap] = await Promise.all([
      this.loadWarehouseAvailableBySku(skus),
      this.loadCatalogHoldersBySku(skus),
      this.loadCatalogPipelineQtyBySku(skus),
    ])
    const items = await Promise.all(rows.map(async (r) => {
      const ready = await this.ensureOrderableIfWarehouseReady(r, stockMap.get(r.sku) || 0)
      return this.attachHolderFields(this.serialize(ready, stockMap.get(r.sku) || 0, pipelineMap.get(r.sku)), holdersMap)
    }))
    return {
      items,
      total,
      page,
      pageSize,
    }
  }

  async detail(id: number) {
    let row = await this.prisma.productPricing.findUnique({
      where: { id: BigInt(id) },
      include: { histories: { orderBy: { id: 'desc' } }, priceRecords: { orderBy: { id: 'asc' } } },
    })
    if (!row) throw new NotFoundException('货盘库存记录不存在')
    const [healed] = await reconcileCatalogFromCompletedInbounds(this.prisma, [row])
    const enriched = await this.ensureMarketPrice(healed)
    const [stockMap, holdersMap, pipelineMap] = await Promise.all([
      this.loadWarehouseAvailableBySku([enriched.sku]),
      this.loadCatalogHoldersBySku([enriched.sku]),
      this.loadCatalogPipelineQtyBySku([enriched.sku]),
    ])
    const ready = await this.ensureOrderableIfWarehouseReady(enriched, stockMap.get(enriched.sku) || 0)
    return this.attachHolderFields(this.serialize(ready, stockMap.get(ready.sku) || 0, pipelineMap.get(ready.sku)), holdersMap)
  }

  /** 累计良品实收范围内设置总额度，并补同步 OMS。 */
  async setVisibleStock(id:number,body:CatalogVisibilityDto,actor?:number) {
    const result=await setCatalogVisibility(this.prisma,id,body,actor)
    let syncPending=false
    try {await tryMarkOrderableOnOms(this.prisma,result.sku);await pushCatalogStockToOms(this.prisma,result.sku)} catch {syncPending=true}
    return {...result,syncPending,message:syncPending?'额度已保存，OMS展示待同步；请核对原设置，勿另建不同额度':result.duplicate?'原额度已核对，未重复调整':'总可见额度已保存，已售量另扣，仓内库存与余额未变'}
  }

  /** 入库发运创建时自动同步货盘库存（海运费、入库数量等） */
  async syncFromInbound(input: SyncInboundCatalogInput) {
    return syncCatalogFromInbound(this.prisma, input)
  }

  /** 入库完结后按实收回写货盘本批入库 */
  async applyInboundActual(input: { inboundNo: string; lines: { sku: string; actualQty: number }[] }) {
    return applyInboundActualToCatalog(this.prisma, input)
  }

  async applyInboundSeaFreight(input: {
    inboundNo: string
    lines: Array<{ sku: string; seaFreightPerUnit: number }>
    action?: string
  }) {
    return applyInboundSeaFreightToCatalog(this.prisma, input)
  }

  async create(data: any) {
    if (/^TKL[0-9]+-/i.test(String(data.sku || ''))) throw new BadRequestException('客户 SKU 不能作为货盘商品创建')
    const sku = toCatalogInternalSku(data.sku)
    await assertGlobalSkuAvailable(this.prisma, { sku, customerSku: catalogBaseSkuFromInternal(sku), excludeErpSku: catalogBaseSkuFromInternal(sku), mirrorOmsSku: sku })
    return this.prisma.productPricing.create({
      data: {
        sku: toCatalogInternalSku(data.sku),
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

  private async pricingTransaction<T>(id: number, work: (service: PricingService) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM product_pricing WHERE id=${BigInt(id)} FOR UPDATE`
      const database = tx as unknown as PrismaService
      const scoped = new PricingService(database, new OperationLogService(database), this.cosUrls)
      return work(scoped)
    }, { maxWait: 10000, timeout: 30000 })
  }

  async confirmPrice(id: number, data: any, role: string, actor?: number) {
    if(data?.clientRequestId != null)return this.runCatalogAction(id,'confirm',data,role,actor)
    return this.pricingTransaction(id, service => service.applyConfirmPrice(id, data, role))
  }

  private async applyConfirmPrice(id: number, data: any, role: string) {
    const row = await this.prisma.productPricing.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('货盘库存记录不存在')
    if (row.pricingStatus !== 'pending_pricing') throw new BadRequestException('当前状态不可定价')

    if (typeof data.finalPrice !== 'number' || billingCents(data.finalPrice) <= 0 || billingCents(data.finalPrice) > 999999999999) throw new BadRequestException('请填写大于零、最多两位小数的有效售价')
    if (data.visibleStockQty != null && data.visibleStockQty !== '' && (!Number.isSafeInteger(data.visibleStockQty) || data.visibleStockQty < 0)) throw new BadRequestException('可见库存须为非负整数，请核对后继续定价')
    const [bounded] = await withCatalogReceiptCaps(this.prisma, [row])
    const visibleStockQty = data.visibleStockQty != null && data.visibleStockQty !== ''
      ? data.visibleStockQty
        : bounded.receivedGoodQty
    if (visibleStockQty > bounded.receivedGoodQty) throw new BadRequestException(`可见总额度最多为累计良品实收 ${bounded.receivedGoodQty} 件，在途与破损不计入`)
    const marketPrice = num(data.marketPrice)
    if (marketPrice <= 0) throw new BadRequestException('请填写市场参考价')

    await this.prisma.productPricing.update({
      where: { id: BigInt(id) },
      data: {
        marketPrice,
        pricingLogic: data.pricingLogic?.trim?.() || null,
        targetProfitRate: data.targetProfitRate,
        finalPrice: data.finalPrice,
        visibleStockQty,
        overseasDeliveryFee: data.overseasDeliveryFee ?? row.overseasDeliveryFee ?? 0,
        platformCommissionRate: data.platformCommission ?? row.platformCommissionRate ?? 0,
        platformDeliveryFee: data.platformDeliveryFee ?? row.platformDeliveryFee ?? 0,
        pricingStatus: 'priced',
      },
    })
    const dev = await this.prisma.productDev.findFirst({
      where: { sku: row.sku },
      orderBy: { id: 'desc' },
    })
    if (dev) {
      await this.prisma.productDev.update({
        where: { id: dev.id },
        data: { marketPrice },
      })
    }
    await this.addHistory(
      BigInt(id),
      role,
      '确认定价',
      `市场参考 R${marketPrice}，最终售价 ¥${data.finalPrice}；对客户可见库存 ${visibleStockQty} 件`,
    )
    return this.detail(id)
  }

  async syncOms(id: number, role: string, data?: any, actor?: number) {
    if(data?.clientRequestId != null)return this.runCatalogAction(id,'sync',data,role,actor)
    return this.pricingTransaction(id, service => service.applySyncOms(id, role))
  }

  private async applySyncOms(id: number, role: string) {
    const row = await this.prisma.productPricing.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('货盘库存记录不存在，请返回列表重新选择')
    if (row.pricingStatus !== 'priced' && row.pricingStatus !== 'synced') {
      throw new BadRequestException('请先完成定价，再同步至OMS')
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

  /**
   * 切换货盘共享状态。停止只关掉新的 OMS 申购，不触碰客户已购买持仓，
   * 因此既有出库单和后续基于持仓的出库仍可正常完成。
   */
  async setShareStatus(id: number, status: unknown, role: string, data?: any, actor?: number) {
    if(data?.clientRequestId != null)return this.runCatalogAction(id,'share',{...data,status},role,actor)
    return this.pricingTransaction(id, service => service.applySetShareStatus(id, status, role))
  }

  private async applySetShareStatus(id: number, status: unknown, role: string) {
    if (status !== 'enabled' && status !== 'stopped') {
      throw new BadRequestException('共享状态请选择开启或停止')
    }
    const row = await this.prisma.productPricing.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('货盘库存记录不存在')
    if (row.pricingStatus !== 'synced') {
      throw new BadRequestException('请先完成定价并同步 OMS，再设置共享状态')
    }

    if (status === 'stopped') {
      const holders = await this.loadCatalogHoldersBySku([row.sku])
      const holderCount = (holders.get(row.sku) || []).length
      await this.prisma.productPricing.update({
        where: { id: BigInt(id) },
        data: {
          shareStatus: 'stopped',
          // 保持可见，客户能辨识商品已停售；仅关闭新的申购入口。
          visibleOnOms: true,
          orderableOnOms: false,
        },
      })
      await this.addHistory(
        BigInt(id),
        role,
        '停止共享',
        `已停止新的 OMS 申购；${holderCount ? `现有 ${holderCount} 个客户持仓及已建出库单不受影响` : '暂无客户持仓'}`,
      )
    } else {
      const [bounded] = await withCatalogReceiptCaps(this.prisma, [row])
      if (remainingCatalogStock(bounded) <= 0) {
        throw new BadRequestException('OMS 展示剩余库存为 0，不能开启共享')
      }
      const stockMap = await this.loadWarehouseAvailableBySku([row.sku])
      const warehouseAvailableQty = stockMap.get(row.sku) || 0
      if (warehouseAvailableQty <= 0) {
        throw new BadRequestException('海外仓暂无可用库存，不能开启共享')
      }
      const now = new Date()
      await this.prisma.productPricing.update({
        where: { id: BigInt(id) },
        data: {
          shareStatus: 'enabled',
          visibleOnOms: true,
          visibleOnOmsAt: row.visibleOnOmsAt ?? now,
          orderableOnOms: true,
          orderableOnOmsAt: now,
        },
      })
      await this.addHistory(
        BigInt(id),
        role,
        '开启共享',
        `OMS 已恢复新客户申购；海外仓可用库存 ${warehouseAvailableQty} 件，展示剩余 ${remainingCatalogStock(bounded)} 件`,
      )
    }

    await pushCatalogStockToOms(this.prisma, row.sku)
    return this.detail(id)
  }

  async listOmsCatalogForOms() {
    // Backfill the publication flag for catalog rows synchronized by older
    // ERP versions. A `synced` row is an explicit OMS publication; leaving the
    // newly added boolean false made it disappear from the OMS catalog.
    await this.prisma.productPricing.updateMany({
      where: { pricingStatus: 'synced', visibleOnOms: false },
      data: { visibleOnOms: true, visibleOnOmsAt: new Date() },
    })
    const items = await listOmsCatalogForDisplay(this.prisma, (url) => this.cosUrls.resolve(url))
    return { items, total: items.length, syncedAt: new Date().toISOString() }
  }

  async getOmsCatalogSkuForOms(sku: string) {
    const item = await getOmsCatalogSkuForDisplay(this.prisma, sku.trim(), (url) => this.cosUrls.resolve(url))
    if (!item) throw new NotFoundException(`SKU ${sku} 未在 OMS 货盘展示`)
    return item
  }

  private findCatalogAction(db: any, requestId: string, actor: number) {
    return db.operationLog.findFirst({where:{module:'pricing_action',operatorId:BigInt(actor),detail:{path:'$.clientRequestId',equals:requestId}}})
  }
  private catalogActionReceipt(row: any, id: number, action: string, requestId: string) {
    if(row.targetId!==String(id)||row.detail.action!==action)throw new ConflictException('原货盘操作属于其它商品或步骤，请返回原操作核对')
    return {requestId,...row.detail.result}
  }
  async readCatalogAction(id: number, action: string, value: string, actor: number) {
    const requestId=this.repriceRequestId(value,'原货盘操作'),row=await this.findCatalogAction(this.prisma,requestId,actor)
    return row?this.catalogActionReceipt(row,id,action,requestId):{requestId,status:'unknown',pricingId:id,action}
  }
  async cancelCatalogAction(id: number, action: string, value: string, actor: number) {
    const requestId=this.repriceRequestId(value,'原货盘操作')
    return this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM sys_user WHERE id=${BigInt(actor)} FOR UPDATE`
      const old=await this.findCatalogAction(tx,requestId,actor)
      if(old)return this.catalogActionReceipt(old,id,action,requestId)
      const result={status:'cancelled',pricingId:id,action}
      await tx.operationLog.create({data:{module:'pricing_action',action,operatorId:BigInt(actor),targetType:'product_pricing',targetId:String(id),detail:{clientRequestId:requestId,action,fingerprint:'',result}}})
      return {requestId,...result}
    })
  }
  private async runCatalogAction(id: number, action: 'confirm'|'sync'|'share', data: any, role: string, actor?: number) {
    const requestId=this.repriceRequestId(data.clientRequestId,'原货盘操作')
    if(!actor||actor<=0||!Number.isSafeInteger(actor))throw new BadRequestException('请使用原账号核对货盘操作')
    const inputs=action==='confirm'?[data.marketPrice,data.pricingLogic?.trim?.()||null,data.finalPrice,data.targetProfitRate??null,data.visibleStockQty??null,data.overseasDeliveryFee??null,data.platformCommission??null,data.platformDeliveryFee??null]:action==='share'?[data.status]:[]
    const fingerprint=createHash('sha256').update(JSON.stringify([id,action,data.expectedUpdatedAt,...inputs])).digest('hex')
    return this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM sys_user WHERE id=${BigInt(actor)} FOR UPDATE`
      const previous=await this.findCatalogAction(tx,requestId,actor)
      if(previous){
        const receipt=this.catalogActionReceipt(previous,id,action,requestId)
        if(receipt.status!=='cancelled'&&previous.detail.fingerprint!==fingerprint)throw new ConflictException('原货盘操作内容不能更改，请先核对或取消原请求')
        return receipt
      }
      await tx.$queryRaw`SELECT id FROM product_pricing WHERE id=${BigInt(id)} FOR UPDATE`
      const row=await tx.productPricing.findUnique({where:{id:BigInt(id)}})
      if(!row)throw new NotFoundException('货盘商品不存在，请返回列表重新核对')
      const expected=typeof data.expectedUpdatedAt==='string'?Date.parse(data.expectedUpdatedAt):NaN
      if(!Number.isFinite(expected)||expected!==row.updatedAt.getTime())throw new ConflictException('货盘资料已变化，旧页面不能覆盖；请读取最新资料后核对再继续')
      const database=tx as unknown as PrismaService,scoped=new PricingService(database,new OperationLogService(database),this.cosUrls)
      if(action==='confirm')await scoped.applyConfirmPrice(id,data,role)
      else if(action==='sync')await scoped.applySyncOms(id,role)
      else await scoped.applySetShareStatus(id,data.status,role)
      const current=await tx.productPricing.findUniqueOrThrow({where:{id:BigInt(id)}})
      const version=new Date(Math.max(Date.now(),current.updatedAt.getTime()+1))
      await tx.productPricing.update({where:{id:current.id},data:{updatedAt:version}})
      const result={status:'confirmed',pricingId:id,action,version:version.toISOString(),pricingStatus:current.pricingStatus,shareStatus:current.shareStatus,price:Number(current.finalPrice??0)}
      await tx.operationLog.create({data:{module:'pricing_action',action,operatorId:BigInt(actor),targetType:'product_pricing',targetId:String(id),detail:{clientRequestId:requestId,action,fingerprint,result}}})
      return {requestId,...result}
    },{maxWait:10000,timeout:30000})
  }

  private repriceRequestId(value: unknown, label='原调价') {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException(`${label}请求编号无效，请返回列表核对`)
    return value.toLowerCase()
  }
  private findRepriceRequest(db: any, requestId: string, actor: number) {
    return db.operationLog.findFirst({ where: { module: 'pricing_reprice', operatorId: BigInt(actor), detail: { path: '$.clientRequestId', equals: requestId } } })
  }
  private repriceReceipt(row: any, id: number, requestId: string) {
    if (row.targetId !== String(id)) throw new ConflictException('原调价请求属于其它商品，请返回原商品核对')
    return { requestId, ...row.detail.result }
  }
  async readRepriceRequest(id: number, value: string, actor: number) {
    const requestId=this.repriceRequestId(value),row=await this.findRepriceRequest(this.prisma,requestId,actor)
    return row ? this.repriceReceipt(row,id,requestId) : { requestId,status:'unknown',pricingId:id }
  }
  async cancelRepriceRequest(id: number, value: string, actor: number) {
    const requestId=this.repriceRequestId(value)
    return this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM sys_user WHERE id=${BigInt(actor)} FOR UPDATE`
      const old=await this.findRepriceRequest(tx,requestId,actor)
      if(old)return this.repriceReceipt(old,id,requestId)
      const result={status:'cancelled',pricingId:id}
      await tx.operationLog.create({data:{module:'pricing_reprice',action:'reprice',operatorId:BigInt(actor),targetType:'product_pricing',targetId:String(id),detail:{clientRequestId:requestId,fingerprint:'',result}}})
      return {requestId,...result}
    })
  }
  async reprice(id: number, data: any, role: string, actor?: number) {
    const nextPrice = data.price ?? data.finalPrice
    if (typeof nextPrice !== 'number' || billingCents(nextPrice) <= 0 || billingCents(nextPrice) > 999999999999) throw new BadRequestException('请填写大于零、最多两位小数的有效售价')
    const requestId=data.clientRequestId == null ? null : this.repriceRequestId(data.clientRequestId)
    if(requestId && (!actor || !Number.isSafeInteger(actor)))throw new BadRequestException('请使用原账号核对调价请求')
    const fingerprint=createHash('sha256').update(JSON.stringify([id,nextPrice,data.marketPrice,data.expectedUpdatedAt,data.note || '手动调价',data.overseasDeliveryFee ?? null,data.platformCommission ?? null,data.platformDeliveryFee ?? null])).digest('hex')
    const saved = await this.prisma.$transaction(async tx => {
      if(requestId){
        await tx.$queryRaw`SELECT id FROM sys_user WHERE id=${BigInt(actor!)} FOR UPDATE`
        const previous=await this.findRepriceRequest(tx,requestId,actor!)
        if(previous){
          const receipt=this.repriceReceipt(previous,id,requestId)
          if(receipt.status!=='cancelled' && previous.detail.fingerprint!==fingerprint)throw new ConflictException('原调价内容不能更改，请先核对或取消原请求')
          return {receipt}
        }
      }
      await tx.$queryRaw`SELECT id FROM product_pricing WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.productPricing.findUnique({ where: { id: BigInt(id) } })
      if (!row) throw new NotFoundException('货盘库存记录不存在，请返回列表重新选择')
      if (row.pricingStatus !== 'synced') throw new BadRequestException('请先完成货盘同步，再继续调整售价')
      const expected = typeof data.expectedUpdatedAt === 'string' ? new Date(data.expectedUpdatedAt) : null
      if (!expected || !Number.isFinite(expected.getTime()) || expected.getTime() !== row.updatedAt.getTime()) throw new ConflictException('定价资料已变化，旧页面不能覆盖；请读取最新定价后核对再继续')

      // A price-only request preserves the reference price under the same version lock.
      // The required audit snapshot must use that resolved value as well.
      if (data.marketPrice !== undefined) {
        try {
          const cents = billingCents(data.marketPrice)
          if (cents <= 0 || cents > 999999999999) throw new Error('invalid reference price')
        } catch {
          throw new BadRequestException('市场参考价须大于零、最多两位小数且在有效范围内')
        }
      }
      const marketPrice = data.marketPrice === undefined ? num(row.marketPrice) : num(data.marketPrice)
      const oldPrice = num(row.finalPrice)
      const updated=await tx.productPricing.update({
        where: { id: BigInt(id) },
        data: {
          marketPrice,
          finalPrice: data.price ?? data.finalPrice,
          overseasDeliveryFee: data.overseasDeliveryFee ?? row.overseasDeliveryFee ?? 0,
          platformCommissionRate: data.platformCommission ?? row.platformCommissionRate ?? 0,
          platformDeliveryFee: data.platformDeliveryFee ?? row.platformDeliveryFee ?? 0,
          omsSyncAt: new Date(),
          updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)),
        },
      })
      await tx.productPriceRecord.create({
        data: {
          pricingId: BigInt(id),
          marketPrice,
          price: data.price ?? data.finalPrice,
          operator: role,
          note: data.note || '手动调价',
        },
      })
      await tx.productPricingHistory.create({ data: { pricingId: BigInt(id), operatorRole: role, action: '调价同步', detail: `市场参考 R${marketPrice}，售价 ¥${oldPrice} → ¥${data.price ?? data.finalPrice}` } })
      // Catalog synchronization currently performs database reads and a local sync-log write only.
      // Keep it in the same transaction so a failed sync log cannot leave an unreceipted price.
      const synced=await pushCatalogStockToOms(tx as unknown as PrismaService,row.sku)
      if(requestId){
        const result={status:'confirmed',pricingId:id,price:nextPrice,version:updated.updatedAt.toISOString(),syncStatus:synced?'recorded':'not_required'}
        await tx.operationLog.create({data:{module:'pricing_reprice',action:'reprice',operatorId:BigInt(actor!),targetType:'product_pricing',targetId:String(id),detail:{clientRequestId:requestId,fingerprint,result}}})
        return {receipt:{requestId,...result}}
      }
      return {receipt:null}
    },{maxWait:10000,timeout:30000})
    return saved.receipt || this.detail(id)
  }
}
