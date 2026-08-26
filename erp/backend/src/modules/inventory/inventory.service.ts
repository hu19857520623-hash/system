import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { OperationLogService } from '../operation-log/operation-log.service'
import {
  fetchCatalogInventoryRows,
  fetchOmsInventoryRows,
  fetchOmsProductRows,
  mergePaginate,
  type MergedInventoryFilters,
  type MergedSkuFilters,
} from './oms-data-bridge.util'
import { parseOmsCustomerCodeFromRemark } from '../../common/oms-sync-meta.util'
import { deriveCustomerCodeFromInternalSku, buildInternalSku } from '../../common/sku-code.util'
import { buildErpWarehouseInventoryRow, finalizeInventoryRow, resolveCustomerIdentity } from '../../common/inventory-row-mapper.util'
import { JHB_WAREHOUSE_NAME } from '../../common/warehouse-display.util'
import { parseInventoryAdjustCsv, type InventoryAdjustImportRow } from './inventory-adjust-import.util'
import { notifyOms } from '../../common/oms-notify.util'
import { pushCatalogStockToOms } from '../pricing/oms-catalog-sync.util'
import { remainingCatalogStock } from '../pricing/catalog-stock.util'
import { CATALOG_CUSTOMER_CODE } from '../../common/catalog-customer.util'
import {
  formatDimLabel,
  numDim,
  resolveBillingDimensions,
} from '../../common/product-dimension.util'
import { InventoryMutationService } from '../../common/inventory/inventory-mutation.service'
import type { InventoryTx } from '../../common/inventory/inventory-mutation.types'

type Tx = InventoryTx

@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    private opLog: OperationLogService,
    private inventoryMutation: InventoryMutationService,
  ) {}

  async query(
    q: PaginationDto & {
      warehouseCode?: string
      warehouseCodes?: string
      warehouseType?: string
      onlyAvailable?: string
      supplierKeyword?: string
      skuCodes?: string
      productCode?: string
      exactSku?: string
      barcode?: string
      category?: string
      qtyType?: string
      qtyMin?: string
      qtyMax?: string
      lowStockOnly?: string
      customerKeyword?: string
      dataSource?: string
    },
  ) {
    const { page, pageSize } = getPagination(q, 20)
    const whList = (q.warehouseCodes || q.warehouseCode || '')
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean)
    const inboundMeta = await this.loadInboundReceivedMeta(
      whList.length === 1 ? whList[0] : whList.length ? undefined : q.warehouseCode,
      q.warehouseType,
    )
    if (whList.length > 1) {
      for (const key of [...inboundMeta.bySkuWh.keys()]) {
        const wh = key.split('::')[1]
        if (!whList.includes(wh)) inboundMeta.bySkuWh.delete(key)
      }
      const skusInWh = new Set([...inboundMeta.bySkuWh.keys()].map((k) => k.split('::')[0]))
      const prods = skusInWh.size
        ? await this.prisma.product.findMany({ where: { sku: { in: [...skusInWh] } }, select: { id: true } })
        : []
      inboundMeta.productIds = prods.map((p) => p.id)
      inboundMeta.productIdSet = new Set(inboundMeta.productIds)
    }
    let productIdFilter = [...inboundMeta.productIds]
    let erpItems: Array<Record<string, unknown>> = []

    // 物流中转仓库存由收货直接写 inventory，不会产生海外仓上架记录。
    // 不能使用 inbound_putaway 作为 productId 唯一入口，否则真实中转库存会被查询层隐藏。
    if (!productIdFilter.length) {
      const requestedWarehouses = await this.prisma.warehouse.findMany({
        where: {
          ...(whList.length ? { warehouseCode: { in: whList } } : {}),
          ...(q.warehouseType ? { warehouseType: q.warehouseType } : {}),
        },
        select: { warehouseCode: true, warehouseType: true },
      })
      const inventoryWarehouseCodes = requestedWarehouses.map((warehouse) => warehouse.warehouseCode)
      if (inventoryWarehouseCodes.length) {
        const inventoryProducts = await this.prisma.inventory.findMany({
          where: { warehouseCode: { in: inventoryWarehouseCodes } },
          select: { productId: true },
          distinct: ['productId'],
        })
        productIdFilter = inventoryProducts.map((row) => row.productId)
      }
    }

    if (q.supplierKeyword?.trim()) {
      const suppliers = await this.prisma.supplier.findMany({
        where: {
          OR: [
            { supplierName: { contains: q.supplierKeyword.trim() } },
            { supplierCode: { contains: q.supplierKeyword.trim() } },
          ],
        },
        select: { id: true },
        take: 50,
      })
      const supplierIds = suppliers.map((s) => s.id)
      if (!supplierIds.length) productIdFilter = []
      else {
        const prods = await this.prisma.product.findMany({
          where: { id: { in: productIdFilter }, supplierId: { in: supplierIds } },
          select: { id: true },
        })
        productIdFilter = prods.map((p) => p.id)
      }
    }

    if (productIdFilter.length) {
    const productAnd: any[] = [{ id: { in: productIdFilter } }]
    const skuTokens = (q.skuCodes || '').split(/[\s,，]+/).map((s) => s.trim()).filter(Boolean)
    if (skuTokens.length) {
      productAnd.push({
        OR: skuTokens.map((sku) => ({ sku: { contains: sku } })),
      })
    }
    const code = (q.productCode || q.keyword || '').trim()
    if (code) {
      productAnd.push(q.exactSku === '1' || q.exactSku === 'true'
        ? { sku: code }
        : { OR: [{ sku: { contains: code } }, { productName: { contains: code } }] })
    }
    if (q.barcode?.trim()) productAnd.push({ barcode: { contains: q.barcode.trim() } })
    if (q.category?.trim()) productAnd.push({ category: { contains: q.category.trim() } })

    const matchedProducts = await this.prisma.product.findMany({
      where: { AND: productAnd },
      select: { id: true },
    })
    productIdFilter = matchedProducts.map((p) => p.id)
    if (productIdFilter.length) {
    const where: any = { productId: { in: productIdFilter } }
    if (whList.length) where.warehouseCode = { in: whList }
    else if (q.warehouseCode && q.warehouseCode !== 'all') where.warehouseCode = q.warehouseCode

    if (q.warehouseType) {
      const whs = await this.prisma.warehouse.findMany({
        where: { warehouseType: q.warehouseType },
        select: { warehouseCode: true },
      })
      const codes = whs.map((w) => w.warehouseCode)
      where.warehouseCode = q.warehouseCode && q.warehouseCode !== 'all'
        ? q.warehouseCode
        : { in: codes }
    }

    if (q.onlyAvailable === 'true' || q.onlyAvailable === '1' || q.lowStockOnly === 'yes') {
      where.availableQty = { gt: 0 }
    }

    const qtyField = q.qtyType === 'locked' ? 'lockedQty' : q.qtyType === 'total' ? 'totalQty' : 'availableQty'
    const qtyMin = q.qtyMin != null && q.qtyMin !== '' ? Number(q.qtyMin) : null
    const qtyMax = q.qtyMax != null && q.qtyMax !== '' ? Number(q.qtyMax) : null
    if ((qtyMin != null && Number.isFinite(qtyMin)) || (qtyMax != null && Number.isFinite(qtyMax))) {
      const qtyCond: { gte?: number; lte?: number } = {}
      if (qtyMin != null && Number.isFinite(qtyMin)) qtyCond.gte = qtyMin
      if (qtyMax != null && Number.isFinite(qtyMax)) qtyCond.lte = qtyMax
      where[qtyField] = qtyCond
    }

    if (code && !q.productCode) {
      const pids = await this.productIdsByKeyword(code)
      const keywordIds = pids.filter((id) => productIdFilter.includes(id))
      if (keywordIds.length) {
        where.AND = [
          { productId: { in: productIdFilter } },
          { OR: [{ sku: { contains: code } }, { productId: { in: keywordIds } }] },
        ]
        delete where.productId
      }
    }

    const rows = await this.prisma.inventory.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 5000,
    })

    const productIds = [...new Set(rows.map((r) => r.productId))]
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } } })
      : []
    const prodMap = new Map(products.map((p) => [Number(p.id), p] as [number, typeof p]))

    const whCodes = [...new Set(rows.map((r) => r.warehouseCode))]
    const warehouses = whCodes.length
      ? await this.prisma.warehouse.findMany({ where: { warehouseCode: { in: whCodes } } })
      : []
    const whMap = new Map(warehouses.map((w) => [w.warehouseCode, w] as [string, typeof w]))
    const skus = rows.map((r) => r.sku)
    const supplierIds = [...new Set(products.map((p) => p.supplierId).filter(Boolean))] as bigint[]
    const [suppliers, pricingRows, pipelineMap] = await Promise.all([
      supplierIds.length
        ? this.prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, supplierCode: true, supplierName: true } })
        : [],
      skus.length
        ? this.prisma.productPricing.findMany({ where: { sku: { in: skus } }, select: { sku: true, finalPrice: true } })
        : [],
      this.loadPipelineQtyMap(whList.length ? whList : whCodes),
    ])
    const supMap = new Map(suppliers.map((s) => [Number(s.id), s] as [number, typeof s]))
    const priceMap = new Map(pricingRows.map((p) => [p.sku, p] as [string, typeof p]))

    const customerCodesToResolve = new Set<string>()
    for (const r of rows) {
      const prod = prodMap.get(Number(r.productId))
      if (!prod) continue
      const fromRemark = parseOmsCustomerCodeFromRemark(prod.remark)
      if (fromRemark) customerCodesToResolve.add(fromRemark)
      const fromSku = deriveCustomerCodeFromInternalSku(r.sku)
      if (fromSku) customerCodesToResolve.add(fromSku)
      const supplier = prod.supplierId ? supMap.get(Number(prod.supplierId)) : undefined
      if (supplier?.supplierCode) customerCodesToResolve.add(String(supplier.supplierCode))
    }
    const erpCustomers = customerCodesToResolve.size
      ? await this.prisma.customer.findMany({
          where: { customerCode: { in: [...customerCodesToResolve] } },
          select: { customerCode: true, customerName: true },
        })
      : []
    const customerNameByCode = new Map(
      erpCustomers.map((c) => [String(c.customerCode).toUpperCase(), c.customerName] as const),
    )

    erpItems = rows.map((r) => {
      const prod = prodMap.get(Number(r.productId))
      const metaKey = `${r.sku}::${r.warehouseCode}`
      const inbound = inboundMeta.bySkuWh.get(metaKey)
      const wh = whMap.get(r.warehouseCode)
      const supplier = prod?.supplierId ? supMap.get(Number(prod.supplierId)) : undefined
      const pricing = priceMap.get(r.sku)
      const pipeline = pipelineMap.get(metaKey) || { inTransit: 0, pendingPutaway: 0 }
      return buildErpWarehouseInventoryRow({
        id: Number(r.id),
        sku: r.sku,
        productId: Number(r.productId),
        productName: prod?.productName || '',
        spec: prod?.spec || '',
        category: prod?.category || '',
        spu: prod?.spu || '',
        barcode: prod?.barcode || '',
        productRemark: prod?.remark,
        rawWarehouseCode: r.warehouseCode,
        warehouseName: wh?.warehouseName || JHB_WAREHOUSE_NAME,
        available: r.availableQty,
        locked: r.lockedQty,
        inTransit: pipeline.inTransit,
        pendingPutaway: pipeline.pendingPutaway,
        fallbackSupplierCode: supplier?.supplierCode,
        fallbackSupplierName: supplier?.supplierName,
        customerNameByCode,
        finalPrice: pricing?.finalPrice != null ? Number(pricing.finalPrice) : null,
        lastInboundDate: inbound?.lastPutawayAt
          ? inbound.lastPutawayAt.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
          : '',
        referenceNo: inbound?.lastInboundNo || '',
        inboundNo: inbound?.lastInboundNo || '',
        putawayQty: inbound?.totalPutawayQty ?? 0,
        sortKey: Number(r.id),
      })
    })
    }
    }

    const mergedFilters: MergedInventoryFilters = {
      customerCode: (q.customerKeyword || q.supplierKeyword)?.trim(),
      skuCodes: q.skuCodes,
      productCode: (q.productCode || q.keyword || '').trim() || undefined,
      exactSku: q.exactSku === '1' || q.exactSku === 'true',
      barcode: q.barcode?.trim(),
      category: q.category?.trim(),
      warehouseCodes: whList.length
        ? whList
        : q.warehouseCode && q.warehouseCode !== 'all'
          ? [q.warehouseCode]
          : undefined,
      qtyType: q.qtyType,
      qtyMin: q.qtyMin != null && q.qtyMin !== '' ? Number(q.qtyMin) : null,
      qtyMax: q.qtyMax != null && q.qtyMax !== '' ? Number(q.qtyMax) : null,
      lowStockOnly: q.lowStockOnly === 'yes',
      onlyAvailable: q.onlyAvailable === 'true' || q.onlyAvailable === '1',
      dataSource: (['erp', 'oms', 'catalog_holdings'].includes(String(q.dataSource || ''))
        ? q.dataSource
        : 'all') as MergedInventoryFilters['dataSource'],
    }

    if (mergedFilters.dataSource === 'catalog_holdings') {
      const catalogHoldings = await fetchCatalogInventoryRows(this.prisma, mergedFilters)
      const { items, total } = mergePaginate([catalogHoldings], page, pageSize)
      const summary = {
        available: catalogHoldings.reduce(
          (sum, r) => sum + Number((r as { sellableQty?: number; availableQty?: number }).sellableQty ?? (r as { availableQty?: number }).availableQty ?? 0),
          0,
        ),
        total: catalogHoldings.reduce(
          (sum, r) => sum + Number((r as { totalQty?: number }).totalQty ?? 0),
          0,
        ),
        locked: catalogHoldings.reduce(
          (sum, r) => sum + Number((r as { lockedQty?: number; pendingOutboundQty?: number }).lockedQty ?? (r as { pendingOutboundQty?: number }).pendingOutboundQty ?? 0),
          0,
        ),
      }
      return {
        items,
        total,
        page,
        pageSize,
        summary,
        sourceCounts: { holdings: catalogHoldings.length },
      }
    }

    const omsItems =
      mergedFilters.dataSource === 'all' || mergedFilters.dataSource === 'oms'
        ? await fetchOmsInventoryRows(this.prisma, mergedFilters)
        : []

    const erpFiltered =
      mergedFilters.dataSource === 'all' || mergedFilters.dataSource === 'erp' ? erpItems : []

    const { items, total } = mergePaginate([erpFiltered, omsItems], page, pageSize)
    const allMerged = [...erpFiltered, ...omsItems]
    const summary = {
      available: allMerged.reduce(
        (sum, r) => sum + Number((r as { sellableQty?: number; availableQty?: number }).sellableQty ?? (r as { availableQty?: number }).availableQty ?? 0),
        0,
      ),
      total: allMerged.reduce(
        (sum, r) => sum + Number((r as { totalQty?: number }).totalQty ?? 0),
        0,
      ),
      locked: allMerged.reduce(
        (sum, r) => sum + Number((r as { lockedQty?: number; pendingOutboundQty?: number }).lockedQty ?? (r as { pendingOutboundQty?: number }).pendingOutboundQty ?? 0),
        0,
      ),
    }

    return {
      items,
      total,
      page,
      pageSize,
      summary,
      sourceCounts: {
        all: erpItems.length + omsItems.length,
        erp: erpItems.length,
        oms: omsItems.length,
      },
    }
  }

  /**
   * SKU 查询：客户创建/维护的商品主数据（尺寸、品名等），不含海外仓实收库存。
   */
  async querySkuCatalog(
    q: PaginationDto & {
      keyword?: string
      title?: string
      skuCodes?: string
      barcode?: string
      category?: string
      brand?: string
      supplierKeyword?: string
      statusFilter?: string
      stockFilter?: string
      costMin?: string
      costMax?: string
      createdFrom?: string
      createdTo?: string
      updatedFrom?: string
      updatedTo?: string
    },
  ) {
    const { page, pageSize } = getPagination(q, 20)
    const statusFilter = (q.statusFilter || q.stockFilter || 'all').trim()
    const title = (q.title || q.keyword || '').trim()
    const and: any[] = []

    if (statusFilter === 'active') and.push({ status: 'active' })
    else if (statusFilter === 'inactive') and.push({ status: 'inactive' })
    else if (statusFilter === 'missing_dims') {
      and.push({
        AND: [
          { OR: [{ lengthCm: null }, { widthCm: null }, { heightCm: null }] },
          { OR: [{ measuredLengthCm: null }, { measuredWidthCm: null }, { measuredHeightCm: null }] },
        ],
      })
    } else if (statusFilter === 'pending') and.push({ status: 'pending' })

    if (title) {
      and.push({
        OR: [
          { productName: { contains: title } },
          { sku: { contains: title } },
          { spec: { contains: title } },
        ],
      })
    }

    const skuTokens = (q.skuCodes || '')
      .split(/[\s,，]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (skuTokens.length === 1) {
      and.push({ sku: { contains: skuTokens[0] } })
    } else if (skuTokens.length > 1) {
      and.push({ OR: skuTokens.map((sku) => ({ sku: { contains: sku } })) })
    }

    if (q.barcode?.trim()) and.push({ barcode: { contains: q.barcode.trim() } })
    if (q.category?.trim()) and.push({ category: { contains: q.category.trim() } })
    if (q.brand?.trim()) and.push({ brand: { contains: q.brand.trim() } })

    const costMin = q.costMin != null && q.costMin !== '' ? Number(q.costMin) : null
    const costMax = q.costMax != null && q.costMax !== '' ? Number(q.costMax) : null
    if ((costMin != null && Number.isFinite(costMin)) || (costMax != null && Number.isFinite(costMax))) {
      const costRmb: { gte?: number; lte?: number } = {}
      if (costMin != null && Number.isFinite(costMin)) costRmb.gte = costMin
      if (costMax != null && Number.isFinite(costMax)) costRmb.lte = costMax
      and.push({ costRmb })
    }

    const parseDayStart = (d: string) => new Date(`${d}T00:00:00`)
    const parseDayEnd = (d: string) => new Date(`${d}T23:59:59.999`)
    if (q.createdFrom?.trim() || q.createdTo?.trim()) {
      const createdAt: { gte?: Date; lte?: Date } = {}
      if (q.createdFrom?.trim()) createdAt.gte = parseDayStart(q.createdFrom.trim())
      if (q.createdTo?.trim()) createdAt.lte = parseDayEnd(q.createdTo.trim())
      and.push({ createdAt })
    }
    if (q.updatedFrom?.trim() || q.updatedTo?.trim()) {
      const updatedAt: { gte?: Date; lte?: Date } = {}
      if (q.updatedFrom?.trim()) updatedAt.gte = parseDayStart(q.updatedFrom.trim())
      if (q.updatedTo?.trim()) updatedAt.lte = parseDayEnd(q.updatedTo.trim())
      and.push({ updatedAt })
    }

    if (q.supplierKeyword?.trim()) {
      const suppliers = await this.prisma.supplier.findMany({
        where: {
          OR: [
            { supplierName: { contains: q.supplierKeyword.trim() } },
            { supplierCode: { contains: q.supplierKeyword.trim() } },
          ],
        },
        select: { id: true },
        take: 50,
      })
      const supplierIds = suppliers.map((s) => s.id)
      if (supplierIds.length) and.push({ supplierId: { in: supplierIds } })
      else and.push({ id: { in: [] as bigint[] } })
    }

    const where = and.length ? { AND: and } : {}
    const omsFilters: MergedSkuFilters = {
      customerCode: q.supplierKeyword?.trim(),
      title: (q.title || q.keyword || '').trim() || undefined,
      skuCodes: q.skuCodes,
      barcode: q.barcode?.trim(),
      category: q.category?.trim(),
      brand: q.brand?.trim(),
      statusFilter,
      costMin: costMin != null && Number.isFinite(costMin) ? costMin : null,
      costMax: costMax != null && Number.isFinite(costMax) ? costMax : null,
      createdFrom: q.createdFrom?.trim(),
      createdTo: q.createdTo?.trim(),
      updatedFrom: q.updatedFrom?.trim(),
      updatedTo: q.updatedTo?.trim(),
    }

    const [erpTotal, allOmsItems] = await Promise.all([
      this.prisma.product.count({ where }),
      fetchOmsProductRows(this.prisma, omsFilters),
    ])

    // ERP 与 OMS 是两个独立数据源。分页顺序固定为 ERP 主数据在前、OMS
    // 客户商品在后，避免先截断 5000 条再在内存分页造成总数和数据缺失。
    const pageStart = (page - 1) * pageSize
    const erpSkip = Math.min(pageStart, erpTotal)
    const erpTake = Math.max(0, Math.min(pageSize, erpTotal - erpSkip))
    const products = erpTake
      ? await this.prisma.product.findMany({
          where,
          orderBy: [{ sku: 'asc' }, { updatedAt: 'desc' }],
          skip: erpSkip,
          take: erpTake,
        })
      : []

    const skus = products.map((p) => p.sku)
    const supplierIds = [...new Set(products.map((p) => p.supplierId).filter(Boolean))] as bigint[]
    const developerIds = [...new Set(products.map((p) => p.developerId).filter(Boolean))] as bigint[]

    const [suppliers, developers, pricingRows] = await Promise.all([
      supplierIds.length
        ? this.prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, supplierCode: true, supplierName: true } })
        : [],
      developerIds.length
        ? this.prisma.sysUser.findMany({ where: { id: { in: developerIds } }, select: { id: true, realName: true, username: true } })
        : [],
      skus.length
        ? this.prisma.productPricing.findMany({
            where: { sku: { in: skus } },
            select: { sku: true, visibleOnOms: true, orderableOnOms: true, finalPrice: true },
          })
        : [],
    ])

    const supMap = new Map(suppliers.map((s) => [Number(s.id), s] as [number, typeof s]))
    const devMap = new Map(developers.map((d) => [Number(d.id), d] as [number, typeof d]))
    const pricingMap = new Map(pricingRows.map((p) => [p.sku, p] as [string, typeof p]))

    const statusLabel = (s: string) => {
      if (s === 'active') return '正式产品'
      if (s === 'inactive') return '停用产品'
      if (s === 'pending') return '待完善'
      return s
    }

    const erpProductBySku = new Map(products.map((p) => [p.sku, p] as const))

    const erpItems = products.map((p) => {
      const supplier = p.supplierId ? supMap.get(Number(p.supplierId)) : undefined
      const developer = p.developerId ? devMap.get(Number(p.developerId)) : undefined
      const pricing = pricingMap.get(p.sku)
      const dims = {
        lengthCm: numDim(p.lengthCm),
        widthCm: numDim(p.widthCm),
        heightCm: numDim(p.heightCm),
        measuredLengthCm: numDim(p.measuredLengthCm),
        measuredWidthCm: numDim(p.measuredWidthCm),
        measuredHeightCm: numDim(p.measuredHeightCm),
      }
      const billing = resolveBillingDimensions(dims)
      const hasCustomerDims = dims.lengthCm != null && dims.widthCm != null && dims.heightCm != null
      const hasMeasuredDims =
        dims.measuredLengthCm != null && dims.measuredWidthCm != null && dims.measuredHeightCm != null
      const wt = numDim(p.weightKg)
      const customer = resolveCustomerIdentity({
        sku: p.sku,
        productRemark: p.remark,
        fallbackSupplierCode: supplier?.supplierCode,
        fallbackSupplierName: supplier?.supplierName,
      })

      let salesStatus = '未上架'
      if (pricing?.orderableOnOms) salesStatus = '允许销售'
      else if (pricing?.visibleOnOms) salesStatus = '仅展示'

      return finalizeInventoryRow({
        id: Number(p.id),
        erpProductId: Number(p.id),
        sku: p.sku,
        spu: p.spu || '',
        productName: p.productName,
        spec: p.spec || '',
        category: p.category || '',
        brand: p.brand || '',
        barcode: p.barcode || '',
        ...dims,
        weightKg: wt,
        costRmb: p.costRmb != null ? Number(p.costRmb) : null,
        status: p.status,
        statusLabel: statusLabel(p.status),
        syncStatus: p.syncStatus || 'pending',
        receiptFlag: hasMeasuredDims ? '已测量' : hasCustomerDims ? '客户申报' : '新产品',
        hasDimensions: billing.source !== 'none',
        customerCode: customer.customerCode || developer?.username || '',
        customerSku: customer.customerSku,
        customerName: customer.customerName,
        supplierName: customer.customerName,
        developerName: developer?.realName || '',
        salesStatus,
        orderableOnOms: Boolean(pricing?.orderableOnOms),
        visibleOnOms: Boolean(pricing?.visibleOnOms),
        finalPrice: pricing?.finalPrice != null ? Number(pricing.finalPrice) : null,
        remark: p.remark || '',
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        measuredAt: p.measuredAt,
        customerDimLabel: formatDimLabel(dims.lengthCm, dims.widthCm, dims.heightCm),
        measuredDimLabel: formatDimLabel(dims.measuredLengthCm, dims.measuredWidthCm, dims.measuredHeightCm),
        billingDimLabel: formatDimLabel(billing.lengthCm, billing.widthCm, billing.heightCm),
        billingDimSource: billing.source,
        dimLabel: formatDimLabel(billing.lengthCm, billing.widthCm, billing.heightCm),
        weightLabel: wt != null ? wt.toFixed(3) : '',
        dataSource: 'erp',
        dataSourceLabel: 'ERP·货盘/主数据',
        editable: true,
        sortKey: p.updatedAt.getTime(),
      })
    })

    const omsStart = Math.max(0, pageStart - erpTotal)
    const omsTake = Math.max(0, pageSize - erpItems.length)
    const omsItems = omsTake ? allOmsItems.slice(omsStart, omsStart + omsTake) : []
    const items = [...erpItems, ...omsItems]
    const total = erpTotal + allOmsItems.length

    const allSkus = [...new Set(items.map((r) => String(r.sku || '')).filter(Boolean))]
    const invFlags = await this.loadSkuInventoryFlags(allSkus)

    const enriched = items.map((row) => {
      const r = row as Record<string, unknown>
      const sku = String(r.sku || '')
      const erpProd = erpProductBySku.get(sku)
      const hasInventory = invFlags.get(sku) ?? false
      const measuredLengthCm = numDim(erpProd?.measuredLengthCm ?? r.measuredLengthCm)
      const measuredWidthCm = numDim(erpProd?.measuredWidthCm ?? r.measuredWidthCm)
      const measuredHeightCm = numDim(erpProd?.measuredHeightCm ?? r.measuredHeightCm)
      const lengthCm = numDim(r.lengthCm)
      const widthCm = numDim(r.widthCm)
      const heightCm = numDim(r.heightCm)
      const billing = resolveBillingDimensions({
        lengthCm,
        widthCm,
        heightCm,
        measuredLengthCm,
        measuredWidthCm,
        measuredHeightCm,
      })
      const customerDimLabel = formatDimLabel(lengthCm, widthCm, heightCm)
      const measuredDimLabel = formatDimLabel(measuredLengthCm, measuredWidthCm, measuredHeightCm)
      const billingDimLabel = formatDimLabel(billing.lengthCm, billing.widthCm, billing.heightCm)
      const erpProductId = r.erpProductId ?? (typeof r.id === 'number' ? r.id : erpProd ? Number(erpProd.id) : null)
      return {
        ...r,
        erpProductId,
        measuredLengthCm,
        measuredWidthCm,
        measuredHeightCm,
        measuredAt: erpProd?.measuredAt ?? r.measuredAt ?? null,
        customerDimLabel: r.customerDimLabel || customerDimLabel,
        measuredDimLabel: r.measuredDimLabel || measuredDimLabel,
        billingDimLabel: r.billingDimLabel || billingDimLabel,
        billingDimSource: r.billingDimSource || billing.source,
        dimLabel: billingDimLabel || customerDimLabel,
        hasInventory,
        editMode: hasInventory ? 'measured_only' : 'full',
        editable: Boolean(erpProductId),
      }
    })

    return { items: enriched, total, page, pageSize }
  }

  async updateSkuCatalogItem(id: number, body: Record<string, unknown>, operatorId?: number) {
    const product = await this.prisma.product.findUnique({ where: { id: BigInt(id) } })
    if (!product) throw new NotFoundException('产品不存在')

    const hasInventory = await this.skuHasInventory(product.sku)
    const parsePosNum = (v: unknown, label: string) => {
      if (v == null || v === '') return null
      const n = Number(v)
      if (!Number.isFinite(n) || n <= 0) throw new BadRequestException(`${label} 须为大于 0 的数字`)
      return n
    }

    const data: Record<string, unknown> = {}
    const lockedFields = ['productName', 'spec', 'barcode', 'brand', 'category', 'weightKg', 'lengthCm', 'widthCm', 'heightCm', 'costRmb', 'status', 'spu']

    if (hasInventory) {
      for (const k of lockedFields) {
        if (body[k] !== undefined) throw new BadRequestException('该 SKU 已有库存，仅可修改仓库实测长宽高')
      }
      if (body.measuredLengthCm !== undefined) data.measuredLengthCm = parsePosNum(body.measuredLengthCm, '实测长')
      if (body.measuredWidthCm !== undefined) data.measuredWidthCm = parsePosNum(body.measuredWidthCm, '实测宽')
      if (body.measuredHeightCm !== undefined) data.measuredHeightCm = parsePosNum(body.measuredHeightCm, '实测高')
      if (Object.keys(data).length) data.measuredAt = new Date()
    } else {
      if (body.productName !== undefined) {
        const name = String(body.productName).trim()
        if (!name) throw new BadRequestException('商品名不能为空')
        data.productName = name
      }
      if (body.spec !== undefined) data.spec = String(body.spec).trim()
      if (body.barcode !== undefined) data.barcode = String(body.barcode).trim()
      if (body.brand !== undefined) data.brand = String(body.brand).trim()
      if (body.category !== undefined) data.category = String(body.category).trim()
      if (body.spu !== undefined) data.spu = String(body.spu).trim()
      if (body.weightKg !== undefined) {
        const w = Number(body.weightKg)
        if (!Number.isFinite(w) || w < 0) throw new BadRequestException('重量无效')
        data.weightKg = w
      }
      if (body.costRmb !== undefined) {
        const c = Number(body.costRmb)
        if (!Number.isFinite(c) || c < 0) throw new BadRequestException('申报成本无效')
        data.costRmb = c
      }
      if (body.lengthCm !== undefined) data.lengthCm = parsePosNum(body.lengthCm, '客户申报长')
      if (body.widthCm !== undefined) data.widthCm = parsePosNum(body.widthCm, '客户申报宽')
      if (body.heightCm !== undefined) data.heightCm = parsePosNum(body.heightCm, '客户申报高')
      if (body.measuredLengthCm !== undefined) data.measuredLengthCm = parsePosNum(body.measuredLengthCm, '实测长')
      if (body.measuredWidthCm !== undefined) data.measuredWidthCm = parsePosNum(body.measuredWidthCm, '实测宽')
      if (body.measuredHeightCm !== undefined) data.measuredHeightCm = parsePosNum(body.measuredHeightCm, '实测高')
      if (
        body.measuredLengthCm !== undefined
        || body.measuredWidthCm !== undefined
        || body.measuredHeightCm !== undefined
      ) {
        data.measuredAt = new Date()
      }
    }

    if (!Object.keys(data).length) throw new BadRequestException('没有可更新的字段')

    const updated = await this.prisma.product.update({
      where: { id: BigInt(id) },
      data,
    })

    await this.opLog.log({
      operatorId,
      module: 'product',
      action: 'sku_catalog_update',
      targetType: 'product',
      targetId: updated.sku,
      detail: { hasInventory, editMode: hasInventory ? 'measured_only' : 'full', changes: data },
    })

    const invFlags = await this.loadSkuInventoryFlags([updated.sku])
    const billing = resolveBillingDimensions({
      lengthCm: numDim(updated.lengthCm),
      widthCm: numDim(updated.widthCm),
      heightCm: numDim(updated.heightCm),
      measuredLengthCm: numDim(updated.measuredLengthCm),
      measuredWidthCm: numDim(updated.measuredWidthCm),
      measuredHeightCm: numDim(updated.measuredHeightCm),
    })

    return {
      id: Number(updated.id),
      erpProductId: Number(updated.id),
      sku: updated.sku,
      productName: updated.productName,
      spec: updated.spec || '',
      barcode: updated.barcode || '',
      brand: updated.brand || '',
      category: updated.category || '',
      spu: updated.spu || '',
      weightKg: numDim(updated.weightKg),
      costRmb: updated.costRmb != null ? Number(updated.costRmb) : null,
      lengthCm: numDim(updated.lengthCm),
      widthCm: numDim(updated.widthCm),
      heightCm: numDim(updated.heightCm),
      measuredLengthCm: numDim(updated.measuredLengthCm),
      measuredWidthCm: numDim(updated.measuredWidthCm),
      measuredHeightCm: numDim(updated.measuredHeightCm),
      measuredAt: updated.measuredAt,
      customerDimLabel: formatDimLabel(numDim(updated.lengthCm), numDim(updated.widthCm), numDim(updated.heightCm)),
      measuredDimLabel: formatDimLabel(numDim(updated.measuredLengthCm), numDim(updated.measuredWidthCm), numDim(updated.measuredHeightCm)),
      billingDimLabel: formatDimLabel(billing.lengthCm, billing.widthCm, billing.heightCm),
      billingDimSource: billing.source,
      hasInventory: invFlags.get(updated.sku) ?? false,
      editMode: invFlags.get(updated.sku) ? 'measured_only' : 'full',
      editable: true,
      dataSource: 'erp',
    }
  }

  private async skuHasInventory(sku: string): Promise<boolean> {
    const flags = await this.loadSkuInventoryFlags([sku])
    return flags.get(sku) ?? false
  }

  private async loadSkuInventoryFlags(skus: string[]): Promise<Map<string, boolean>> {
    const map = new Map<string, boolean>()
    const unique = [...new Set(skus.filter(Boolean))]
    if (!unique.length) return map

    const erpInv = await this.prisma.inventory.findMany({
      where: { sku: { in: unique } },
      select: { sku: true, totalQty: true, availableQty: true, lockedQty: true },
    })
    for (const r of erpInv) {
      const qty = Math.max(Number(r.totalQty) || 0, Number(r.availableQty) || 0, Number(r.lockedQty) || 0)
      if (qty > 0) map.set(r.sku, true)
    }

    const locRows = await this.prisma.inventoryLocation.findMany({
      where: { sku: { in: unique }, qty: { gt: 0 } },
      select: { sku: true },
      distinct: ['sku'],
    })
    for (const r of locRows) map.set(r.sku, true)

    try {
      const placeholders = unique.map(() => '?').join(',')
      const omsRows = await this.prisma.$queryRawUnsafe<{ sku: string; available: unknown; locked: unknown }[]>(
        `SELECT sku, available, locked FROM oms_InventoryItem WHERE sku IN (${placeholders})`,
        ...unique,
      )
      for (const r of omsRows) {
        const qty = Number(r.available || 0) + Number(r.locked || 0)
        if (qty > 0) map.set(r.sku, true)
      }
    } catch {
      // OMS 表可能不存在
    }
    return map
  }

  /** 海外仓实收入库：来自上架记录的 SKU / 仓库维度汇总 */
  private async loadInboundReceivedMeta(warehouseCode?: string, warehouseType?: string) {
    let whCodes: string[] | undefined
    if (warehouseCode && warehouseCode !== 'all') {
      whCodes = [warehouseCode]
    } else if (warehouseType) {
      const whs = await this.prisma.warehouse.findMany({
        where: { warehouseType },
        select: { warehouseCode: true },
      })
      whCodes = whs.map((w) => w.warehouseCode)
    }

    const putaways = await this.prisma.inboundPutawayItem.findMany({
      orderBy: { putawayAt: 'desc' },
      select: {
        inboundItemId: true,
        qty: true,
        putawayAt: true,
        order: { select: { inboundNo: true, warehouseCode: true } },
      },
    })

    const itemIds = [...new Set(putaways.map((p) => p.inboundItemId))]
    const orderItems = itemIds.length
      ? await this.prisma.inboundOrderItem.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, productId: true, sku: true },
        })
      : []
    const itemMap = new Map(orderItems.map((i) => [i.id, i] as [typeof i.id, typeof i]))

    const productIdSet = new Set<bigint>()
    const bySkuWh = new Map<string, { lastInboundNo: string; lastPutawayAt: Date; totalPutawayQty: number }>()

    for (const p of putaways) {
      const item = itemMap.get(p.inboundItemId)
      if (!item) continue
      const wh = p.order.warehouseCode
      if (whCodes?.length && !whCodes.includes(wh)) continue

      productIdSet.add(item.productId)
      const key = `${item.sku}::${wh}`
      const prev = bySkuWh.get(key)
      if (!prev) {
        bySkuWh.set(key, {
          lastInboundNo: p.order.inboundNo,
          lastPutawayAt: p.putawayAt,
          totalPutawayQty: p.qty,
        })
      } else {
        prev.totalPutawayQty += p.qty
      }
    }

    return {
      productIds: [...productIdSet],
      productIdSet,
      bySkuWh,
    }
  }

  /** 在途 / 待上架数量（按 SKU+仓库） */
  private async loadPipelineQtyMap(warehouseCodes: string[]) {
    const inTransitStatuses = ['pending_receipt', 'pending_push', 'arrived', 'receiving', 'exception']
    const where: any = {
      status: { in: [...inTransitStatuses, 'pending_putaway'] },
    }
    if (warehouseCodes.length) where.warehouseCode = { in: warehouseCodes }

    const orders = await this.prisma.inboundOrder.findMany({
      where,
      select: {
        warehouseCode: true,
        status: true,
        items: {
          select: {
            sku: true,
            expectedQty: true,
            actualQty: true,
            putawayQty: true,
          },
        },
      },
    })

    const map = new Map<string, { inTransit: number; pendingPutaway: number }>()
    for (const order of orders) {
      for (const item of order.items) {
        const key = `${item.sku}::${order.warehouseCode}`
        const prev = map.get(key) || { inTransit: 0, pendingPutaway: 0 }
        if (inTransitStatuses.includes(order.status)) {
          const remain = Math.max(0, item.expectedQty - (item.actualQty ?? 0))
          prev.inTransit += remain > 0 ? remain : item.expectedQty
        }
        if (order.status === 'pending_putaway') {
          const base = item.actualQty ?? item.expectedQty
          prev.pendingPutaway += Math.max(0, base - (item.putawayQty ?? 0))
        }
        map.set(key, prev)
      }
    }
    return map
  }

  private async productIdsByKeyword(keyword: string): Promise<bigint[]> {
    const rows = await this.prisma.product.findMany({
      where: { productName: { contains: keyword } },
      select: { id: true },
      take: 50,
    })
    return rows.map((r) => r.id)
  }

  /** 货盘选品购买明细（oms_catalog_order） */
  async catalogPurchases(q: PaginationDto & { sku?: string; customerCode?: string }) {
    const { page, pageSize } = getPagination(q, 20)
    const and: Record<string, unknown>[] = []
    const sku = q.sku?.trim()
    const customerCode = q.customerCode?.trim()
    if (sku) and.push({ sku })
    if (customerCode) and.push({ customerCode })

    const where = and.length ? { AND: and } : {}
    const [orders, total] = await Promise.all([
      this.prisma.omsCatalogOrder.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.omsCatalogOrder.count({ where }),
    ])

    const customerIds = [...new Set(orders.map((o) => o.customerId))]
    const customers = customerIds.length
      ? await this.prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, customerCode: true, customerName: true },
        })
      : []
    const customerMap = new Map(customers.map((c) => [Number(c.id), c]))

    const items = orders.map((o) => {
      const customer = customerMap.get(Number(o.customerId))
      return {
        id: Number(o.id),
        orderNo: o.orderNo,
        sku: o.sku,
        customerCode: o.customerCode || customer?.customerCode || '',
        customerName: customer?.customerName || '',
        quantity: o.quantity,
        unitPrice: o.unitPrice != null ? Number(o.unitPrice) : null,
        totalAmount: o.totalAmount != null ? Number(o.totalAmount) : null,
        balanceBefore: o.balanceBefore != null ? Number(o.balanceBefore) : null,
        balanceAfter: o.balanceAfter != null ? Number(o.balanceAfter) : null,
        status: o.status,
        createdAt: o.createdAt,
      }
    })

    return { items, total, page, pageSize }
  }

  /**
   * ERP 收回客户货盘持有：客户申购后虽可发货，控制权仍在 ERP。
   * 收回后库存回流货盘池，并同步 OMS 扣减客户锁定量（收回发货权限）。
   */
  async reclaimCatalogHolding(
    body: { customerCode: string; sku: string; quantity: number; remark?: string },
    operatorId?: number,
  ) {
    const customerCode = body.customerCode?.trim()
    const sku = body.sku?.trim()
    const quantity = Math.floor(Number(body.quantity))
    if (!customerCode) throw new BadRequestException('请填写客户代码')
    if (customerCode.toUpperCase() === CATALOG_CUSTOMER_CODE) {
      throw new BadRequestException('不能从平台货盘客户 TKL 收回，请指定申购客户')
    }
    if (!sku) throw new BadRequestException('请填写 SKU')
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('收回数量须大于 0')
    }

    const customer = await this.prisma.customer.findUnique({ where: { customerCode } })
    if (!customer) throw new NotFoundException(`客户 ${customerCode} 不存在`)
    if (customer.status !== 1) throw new BadRequestException(`客户 ${customerCode} 已停用`)

    const holding = await this.prisma.customerSkuInventory.findUnique({
      where: { customerId_sku: { customerId: customer.id, sku } },
    })
    if (!holding || holding.quantity < quantity) {
      throw new BadRequestException(
        `客户 ${customerCode} 持有 ${sku} 仅 ${holding?.quantity ?? 0} 件，无法收回 ${quantity} 件`,
      )
    }

    const pricing = await this.prisma.productPricing.findUnique({ where: { sku } })
    if (!pricing) throw new NotFoundException(`SKU ${sku} 不在货盘定价池中`)

    const refNo = `RCL-${Date.now()}`
    const remark = body.remark?.trim() || 'ERP 收回货盘持有'
    const soldBefore = pricing.soldQty ?? 0
    const holdBefore = holding.quantity

    const result = await this.prisma.$transaction(async (tx) => {
      const remainQty = holding.quantity - quantity
      if (remainQty <= 0) {
        await tx.customerSkuInventory.delete({ where: { id: holding.id } })
      } else {
        await tx.customerSkuInventory.update({
          where: { id: holding.id },
          data: { quantity: remainQty },
        })
      }

      const newSoldQty = Math.max(0, soldBefore - quantity)
      await tx.productPricing.update({
        where: { id: pricing.id },
        data: { soldQty: newSoldQty },
      })

      await tx.productPricingHistory.create({
        data: {
          pricingId: pricing.id,
          operatorRole: 'ERP',
          action: '收回持有',
          detail:
            `从客户 ${customerCode} 收回 ${quantity} 件（持有 ${holdBefore} → ${remainQty}）；` +
            `货盘已售 ${soldBefore} → ${newSoldQty}。${remark}`,
        },
      })

      await tx.syncLog.create({
        data: {
          syncType: 'catalog_reclaim',
          targetSystem: 'OMS',
          referenceNo: refNo,
          status: 'success',
          requestBody: { customerCode, sku, quantity, remark } as object,
          responseBody: { remainQty, newSoldQty },
        },
      })

      return { remainQty, newSoldQty }
    })

    await pushCatalogStockToOms(this.prisma, sku)
    await notifyOms('inventory.changed', customerCode, {
      action: 'catalog_reclaim',
      sku,
      quantity,
      remainingQty: result.remainQty,
      reason: remark,
      referenceNo: refNo,
    })

    await this.opLog.log({
      operatorId,
      module: 'inventory',
      action: 'catalog_reclaim',
      targetType: 'customer_sku_inventory',
      targetId: sku,
      detail: {
        customerCode,
        quantity,
        remainingQty: result.remainQty,
        remark,
        referenceNo: refNo,
      },
    })

    const refreshed = await this.prisma.productPricing.findUnique({ where: { sku } })
    return {
      customerCode,
      sku,
      quantity,
      remainingQty: result.remainQty,
      catalogSoldQty: result.newSoldQty,
      catalogRemainingStock: refreshed ? remainingCatalogStock(refreshed) : 0,
      referenceNo: refNo,
      message: `已从客户 ${customerCode} 收回 ${quantity} 件，货盘池已回流；客户对应发货权限已扣减`,
    }
  }

  logs(sku: string, warehouseCode?: string) {
    const where: any = { sku }
    if (warehouseCode) where.warehouseCode = warehouseCode
    return this.prisma.inventoryLog.findMany({ where, orderBy: { id: 'desc' }, take: 100 })
  }

  /** SKU 出库流水：发运扣减记录 + 关联出库单信息 */
  async outboundLogs(sku: string, warehouseCode?: string) {
    const where: any = { sku, changeType: 'outbound' }
    if (warehouseCode && warehouseCode !== 'all') where.warehouseCode = warehouseCode

    const rows = await this.prisma.inventoryLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 200,
    })
    if (!rows.length) return []

    const outboundNos = [...new Set(rows.map((r) => r.referenceNo).filter(Boolean))] as string[]
    const operatorIds = [...new Set(rows.map((r) => r.operatorId).filter(Boolean))] as bigint[]

    const orders = outboundNos.length
      ? await this.prisma.outboundOrder.findMany({
          where: { outboundNo: { in: outboundNos } },
          include: { items: true },
        })
      : []
    const operators = operatorIds.length
      ? await this.prisma.sysUser.findMany({
          where: { id: { in: operatorIds } },
          select: { id: true, realName: true },
        })
      : []

    const customerIds = [...new Set(orders.map((o) => o.customerId).filter(Boolean))] as bigint[]
    const customers = customerIds.length
      ? await this.prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, customerName: true },
        })
      : []
    const customerMap = new Map(customers.map((c) => [Number(c.id), c.customerName] as [number, string]))
    const orderMap = new Map(orders.map((o) => [o.outboundNo, o] as [string, typeof o]))
    const operatorMap = new Map(operators.map((u) => [Number(u.id), u.realName] as [number, string]))

    const DEST_LABEL: Record<string, string> = {
      cpt: 'CPT',
      jhb: 'JHB',
      fba: 'FBA',
      local: '本地',
    }
    const STATUS_LABEL: Record<string, string> = {
      shipped: '已发运',
      delivered: '已签收',
      cancelled: '已取消',
      packed: '已打包',
      pending_pick: '待拣货',
      picking: '拣货中',
      picked: '已拣货',
      reviewing: '复核中',
      exception: '异常',
    }

    return rows.map((r) => {
      const order = r.referenceNo ? orderMap.get(r.referenceNo) : undefined
      const line = order?.items.find((i) => i.sku === r.sku)
      const qty = Math.abs(r.changeQty)
      const locationMatch = r.remark?.match(/库位\s+(\S+)/)
      const shippedAt = order?.shippedAt || r.createdAt
      return {
        id: Number(r.id),
        sku: r.sku,
        warehouseCode: r.warehouseCode,
        outboundNo: r.referenceNo || '',
        outboundId: order ? Number(order.id) : null,
        qty: line?.pickedQty || line?.qty || qty,
        logQty: qty,
        shippedAt,
        createdAt: r.createdAt,
        customerName: order?.customerId ? customerMap.get(Number(order.customerId)) || '—' : '—',
        destType: order?.destType || '',
        destLabel: order ? DEST_LABEL[order.destType] || order.destType.toUpperCase() : '—',
        status: order?.status || '',
        statusLabel: order ? STATUS_LABEL[order.status] || order.status : '—',
        operatorName: r.operatorId ? operatorMap.get(Number(r.operatorId)) || '—' : '—',
        locationCode: line?.locationCode || locationMatch?.[1] || '',
        remark: r.remark || '',
        beforeQty: r.beforeQty,
        afterQty: r.afterQty,
      }
    })
  }

  async queryByLocation(q: { warehouseCode?: string; sku?: string; locationCode?: string }) {
    const where: any = {
      qty: { gt: 0 },
      inboundNo: { startsWith: 'IN-' },
    }
    if (q.warehouseCode) where.warehouseCode = q.warehouseCode
    if (q.sku) where.sku = q.sku
    if (q.locationCode) where.locationCode = q.locationCode

    const rows = await this.prisma.inventoryLocation.findMany({
      where,
      orderBy: [{ warehouseCode: 'asc' }, { locationCode: 'asc' }, { sku: 'asc' }],
      take: 500,
    })

    const productIds = [...new Set(rows.map((r) => r.productId))]
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, productName: true } })
      : []
    const prodMap = new Map(products.map((p) => [Number(p.id), p.productName] as [number, string]))

    return rows.map((r) => ({
      id: Number(r.id),
      productId: Number(r.productId),
      sku: r.sku,
      productName: prodMap.get(Number(r.productId)) || '',
      warehouseCode: r.warehouseCode,
      locationId: Number(r.locationId),
      locationCode: r.locationCode,
      qty: r.qty,
      batchNo: r.batchNo,
      inboundNo: r.inboundNo,
      updatedAt: r.updatedAt,
    }))
  }

  private applyWarehouseQtyDelta(
    tx: Tx,
    productId: bigint,
    sku: string,
    warehouseCode: string,
    diff: number,
    operatorId: number | undefined,
    meta: { changeType: string; remark?: string; referenceNo?: string },
  ) {
    return this.inventoryMutation.applyWarehouseQtyDelta(tx, {
      productId,
      sku,
      warehouseCode,
      diff,
      operatorId,
      ...meta,
    })
  }

  private formatCustomerRemark(customerCode: string, remark?: string) {
    const code = customerCode.trim()
    const base = `[客户:${code}]`
    const extra = remark?.trim()
    return extra ? `${base} ${extra}` : base
  }

  private async assertActiveCustomer(customerCode: string) {
    const code = customerCode.trim()
    if (!code) throw new BadRequestException('请填写客户代码')
    const customer = await this.prisma.customer.findUnique({ where: { customerCode: code } })
    if (!customer) throw new NotFoundException(`客户代码 ${code} 不存在`)
    if (customer.status !== 1) throw new BadRequestException(`客户 ${code} 已停用`)
    return customer
  }

  private async resolveProductForCustomer(customerCode: string, skuInput: string) {
    const input = skuInput.trim()
    if (!input) throw new BadRequestException('SKU 不能为空')

    let product = await this.prisma.product.findFirst({ where: { sku: input } })
    if (product) return product

    const prefixed = buildInternalSku(customerCode, input)
    product = await this.prisma.product.findFirst({ where: { sku: prefixed } })
    if (product) return product

    const code = customerCode.trim().toUpperCase()
    if (input.toUpperCase().startsWith(`${code}-`)) {
      product = await this.prisma.product.findFirst({ where: { sku: input } })
      if (product) return product
    }

    throw new NotFoundException(`客户 ${customerCode} 下未找到 SKU ${input}`)
  }

  async applyLocationChange(
    body: {
      customerCode: string
      sku: string
      warehouseCode: string
      fromLocationCode?: string
      toLocationCode: string
      qty: number
      remark?: string
    },
    operatorId?: number,
  ) {
    const customerCode = body.customerCode?.trim()
    if (!customerCode) throw new BadRequestException('请填写客户代码')
    await this.assertActiveCustomer(customerCode)

    const warehouseCode = body.warehouseCode?.trim()
    const toLocationCode = body.toLocationCode?.trim()
    const fromLocationCode = body.fromLocationCode?.trim() || ''
    const qty = Number(body.qty)

    if (!warehouseCode || !toLocationCode) throw new BadRequestException('仓库与目标库位不能为空')
    if (!Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty)) {
      throw new BadRequestException('数量须为非负整数')
    }

    const product = await this.resolveProductForCustomer(customerCode, body.sku)
    const remark = this.formatCustomerRemark(customerCode, body.remark)

    if (fromLocationCode && fromLocationCode !== toLocationCode) {
      const source = await this.prisma.inventoryLocation.findFirst({
        where: { productId: product.id, warehouseCode, locationCode: fromLocationCode },
      })
      if (!source) throw new NotFoundException(`原库位 ${fromLocationCode} 无 SKU ${product.sku} 库存`)
      return this.updateLocationLine(Number(source.id), {
        qty,
        locationCode: toLocationCode,
        remark,
        customerCode,
      }, operatorId)
    }

    const target = await this.prisma.inventoryLocation.findFirst({
      where: { productId: product.id, warehouseCode, locationCode: toLocationCode },
    })
    if (target) {
      return this.updateLocationLine(Number(target.id), {
        qty,
        locationCode: toLocationCode,
        remark,
        customerCode,
      }, operatorId)
    }

    if (qty <= 0) throw new BadRequestException('新库位库存数量须大于 0')
    return this.addLocationStock({
      sku: product.sku,
      warehouseCode,
      locationCode: toLocationCode,
      qty,
      remark,
      customerCode,
    }, operatorId)
  }

  async batchApplyLocationChange(
    input: { rows?: InventoryAdjustImportRow[]; content?: string; defaultWarehouse?: string },
    operatorId?: number,
  ) {
    const rows = input.rows?.length
      ? input.rows
      : parseInventoryAdjustCsv(String(input.content || ''), input.defaultWarehouse || 'WMS-JHB-01')

    const results: Array<{ line: number; ok: boolean; sku?: string; error?: string }> = []
    let ok = 0
    let fail = 0

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      try {
        await this.applyLocationChange(row, operatorId)
        results.push({ line: i + 2, ok: true, sku: row.sku })
        ok++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        results.push({ line: i + 2, ok: false, sku: row.sku, error: message })
        fail++
      }
    }

    return { ok, fail, total: rows.length, results }
  }

  async updateLocationLine(
    id: number,
    body: { qty?: number; locationCode?: string; remark?: string; customerCode?: string },
    operatorId?: number,
  ) {
    const row = await this.prisma.inventoryLocation.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('库位库存不存在')
    if (row.qty <= 0) throw new BadRequestException('该库位库存已为空')

    const customerCode = body.customerCode?.trim()
    if (!customerCode) throw new BadRequestException('请填写客户代码')
    await this.assertActiveCustomer(customerCode)

    const oldQty = row.qty
    const oldLocationCode = row.locationCode
    const newQty = body.qty != null ? Number(body.qty) : oldQty
    const newLocationCode = body.locationCode?.trim() || oldLocationCode

    if (!Number.isFinite(newQty) || newQty < 0 || !Number.isInteger(newQty)) {
      throw new BadRequestException('数量须为非负整数')
    }

    const locationChanged = newLocationCode !== oldLocationCode
    const qtyChanged = newQty !== oldQty
    if (!locationChanged && !qtyChanged) {
      return {
        id: Number(row.id),
        sku: row.sku,
        warehouseCode: row.warehouseCode,
        locationCode: row.locationCode,
        qty: row.qty,
        batchNo: row.batchNo,
        inboundNo: row.inboundNo,
      }
    }

    const refNo = `ADJ-${Date.now()}`
    const remark = this.formatCustomerRemark(customerCode, body.remark)

    const result = await this.prisma.$transaction(async (tx) => {
      if (locationChanged) {
        const targetLoc = await tx.warehouseLocation.findFirst({
          where: {
            warehouseCode: row.warehouseCode,
            locationCode: newLocationCode,
            status: 'available',
          },
        })
        if (!targetLoc) throw new BadRequestException(`库位 ${newLocationCode} 不可用或不存在`)

        await tx.inventoryLocation.delete({ where: { id: row.id } })

        if (newQty > 0) {
          const existing = await tx.inventoryLocation.findFirst({
            where: {
              productId: row.productId,
              locationId: targetLoc.id,
              batchNo: row.batchNo,
            },
          })
          if (existing) {
            await tx.inventoryLocation.update({
              where: { id: existing.id },
              data: { qty: existing.qty + newQty, inboundNo: row.inboundNo ?? existing.inboundNo },
            })
          } else {
            await tx.inventoryLocation.create({
              data: {
                productId: row.productId,
                sku: row.sku,
                warehouseCode: row.warehouseCode,
                locationId: targetLoc.id,
                locationCode: targetLoc.locationCode,
                qty: newQty,
                batchNo: row.batchNo,
                inboundNo: row.inboundNo,
              },
            })
          }
        }

        const whDiff = newQty - oldQty
        if (whDiff !== 0) {
          await this.applyWarehouseQtyDelta(tx, row.productId, row.sku, row.warehouseCode, whDiff, operatorId, {
            changeType: 'adjust',
            remark: remark || `移库并调整 ${oldLocationCode}(${oldQty}) → ${newLocationCode}(${newQty})`,
            referenceNo: refNo,
          })
        } else {
          const whInv = await tx.inventory.findUnique({
            where: { productId_warehouseCode: { productId: row.productId, warehouseCode: row.warehouseCode } },
          })
          await tx.inventoryLog.create({
            data: {
              productId: row.productId,
              sku: row.sku,
              warehouseCode: row.warehouseCode,
              changeType: 'move',
              changeQty: newQty,
              beforeQty: whInv?.totalQty ?? oldQty,
              afterQty: whInv?.totalQty ?? oldQty,
              referenceNo: refNo,
              operatorId: operatorId ? BigInt(operatorId) : undefined,
              remark: remark || `移库 ${oldLocationCode} → ${newLocationCode} · ${newQty} 件`,
            },
          })
        }

        return {
          id: Number(row.id),
          sku: row.sku,
          warehouseCode: row.warehouseCode,
          locationCode: newLocationCode,
          qty: newQty,
          batchNo: row.batchNo,
          inboundNo: row.inboundNo,
          moved: true,
        }
      }

      const diff = newQty - oldQty
      if (newQty === 0) {
        await tx.inventoryLocation.delete({ where: { id: row.id } })
      } else {
        await tx.inventoryLocation.update({ where: { id: row.id }, data: { qty: newQty } })
      }

      await this.applyWarehouseQtyDelta(tx, row.productId, row.sku, row.warehouseCode, diff, operatorId, {
        changeType: 'adjust',
        remark: remark || `库位 ${oldLocationCode} 数量 ${oldQty} → ${newQty}`,
        referenceNo: refNo,
      })

      return {
        id: Number(row.id),
        sku: row.sku,
        warehouseCode: row.warehouseCode,
        locationCode: oldLocationCode,
        qty: newQty,
        batchNo: row.batchNo,
        inboundNo: row.inboundNo,
      }
    })

    await this.opLog.log({
      operatorId,
      module: 'inventory',
      action: locationChanged ? 'adjust_location' : 'adjust_qty',
      targetType: 'inventory_location',
      targetId: row.sku,
      detail: {
        warehouseCode: row.warehouseCode,
        fromLocation: oldLocationCode,
        toLocation: newLocationCode,
        fromQty: oldQty,
        toQty: newQty,
        remark: body.remark,
        customerCode,
        referenceNo: refNo,
      },
    })

    return result
  }

  async addLocationStock(
    body: {
      sku: string
      warehouseCode: string
      locationCode: string
      qty: number
      remark?: string
      customerCode: string
    },
    operatorId?: number,
  ) {
    const customerCode = body.customerCode?.trim()
    if (!customerCode) throw new BadRequestException('请填写客户代码')
    await this.assertActiveCustomer(customerCode)

    const sku = body.sku?.trim()
    const warehouseCode = body.warehouseCode?.trim()
    const locationCode = body.locationCode?.trim()
    const qty = Number(body.qty)

    if (!sku || !warehouseCode || !locationCode) {
      throw new BadRequestException('SKU、仓库、库位不能为空')
    }
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
      throw new BadRequestException('数量须为正整数')
    }

    const product = await this.prisma.product.findFirst({ where: { sku } })
    if (!product) throw new NotFoundException(`SKU ${sku} 不存在`)

    const locCodeUpper = locationCode.toUpperCase()
    const loc = await this.prisma.warehouseLocation.findFirst({
      where: {
        warehouseCode,
        locationCode: locCodeUpper,
        status: 'available',
      },
    }) ?? (locationCode !== locCodeUpper
      ? await this.prisma.warehouseLocation.findFirst({
          where: { warehouseCode, locationCode, status: 'available' },
        })
      : null)
    if (!loc) throw new BadRequestException(`库位 ${locationCode} 不可用或不存在`)

    const refNo = `ADJ-${Date.now()}`
    const remark = this.formatCustomerRemark(customerCode, body.remark)

    const result = await this.prisma.$transaction(async (tx) => {
      const invLoc = await tx.inventoryLocation.findFirst({
        where: { productId: product.id, locationId: loc.id, batchNo: null },
      })

      let lineId: bigint
      let lineQty: number
      if (invLoc) {
        lineQty = invLoc.qty + qty
        await tx.inventoryLocation.update({
          where: { id: invLoc.id },
          data: { qty: lineQty },
        })
        lineId = invLoc.id
      } else {
        const created = await tx.inventoryLocation.create({
          data: {
            productId: product.id,
            sku,
            warehouseCode,
            locationId: loc.id,
            locationCode: loc.locationCode,
            qty,
          },
        })
        lineId = created.id
        lineQty = qty
      }

      await this.applyWarehouseQtyDelta(tx, product.id, sku, warehouseCode, qty, operatorId, {
        changeType: 'adjust',
        remark: remark || `库位 ${loc.locationCode} 增加库存 +${qty}`,
        referenceNo: refNo,
      })

      return {
        id: Number(lineId),
        sku,
        warehouseCode,
        locationCode: loc.locationCode,
        qty: lineQty,
        batchNo: null,
        inboundNo: invLoc?.inboundNo ?? null,
      }
    })

    await this.opLog.log({
      operatorId,
      module: 'inventory',
      action: 'add_location',
      targetType: 'inventory_location',
      targetId: sku,
      detail: {
        warehouseCode,
        locationCode: result.locationCode,
        addQty: qty,
        afterQty: result.qty,
        remark: body.remark,
        customerCode,
        referenceNo: refNo,
      },
    })

    return result
  }
}
