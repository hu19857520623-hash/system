import { PrismaService } from '../../common/prisma/prisma.service'
import { CATALOG_CUSTOMER_CODE, catalogBaseSkuFromInternal } from '../../common/catalog-customer.util'
import { remainingCatalogStock } from '../pricing/catalog-stock.util'
import {
  buildCatalogHoldingInventoryRow,
  buildOmsWarehouseInventoryRow,
  finalizeInventoryRow,
  finalizeInventoryRows,
  inventoryDataSourceLabel,
  resolveCustomerIdentity,
} from '../../common/inventory-row-mapper.util'
import { expandWarehouseSearchTerms } from '../../common/warehouse-display.util'

export { expandWarehouseSearchTerms } from '../../common/warehouse-display.util'

export type MergedInventoryFilters = {
  customerCode?: string
  skuCodes?: string
  productCode?: string
  exactSku?: boolean
  barcode?: string
  category?: string
  warehouseCodes?: string[]
  qtyType?: string
  qtyMin?: number | null
  qtyMax?: number | null
  lowStockOnly?: boolean
  onlyAvailable?: boolean
  dataSource?: 'all' | 'erp' | 'oms' | 'catalog_holdings'
}

const SOURCE_SORT: Record<string, number> = { erp: 0, oms: 1, catalog: 2 }

export type MergedSkuFilters = {
  customerCode?: string
  title?: string
  skuCodes?: string
  barcode?: string
  category?: string
  brand?: string
  statusFilter?: string
  costMin?: number | null
  costMax?: number | null
  createdFrom?: string
  createdTo?: string
  updatedFrom?: string
  updatedTo?: string
}

const skuTokens = (raw?: string) =>
  (raw || '')
    .split(/[\s,，]+/)
    .map((s) => s.trim())
    .filter(Boolean)

function likeParam(v: string) {
  return `%${v}%`
}

function pushSkuFilter(
  conditions: string[],
  params: unknown[],
  column: string,
  tokens: string[],
  exact?: boolean,
) {
  if (!tokens.length) return
  if (tokens.length === 1 && !exact) {
    conditions.push(`${column} LIKE ?`)
    params.push(likeParam(tokens[0]))
    return
  }
  conditions.push(`(${tokens.map(() => `${column} LIKE ?`).join(' OR ')})`)
  for (const t of tokens) params.push(likeParam(t))
}

function pushQtyFilter(
  conditions: string[],
  params: unknown[],
  column: string,
  qtyType: string | undefined,
  qtyMin: number | null,
  qtyMax: number | null,
  lowStockOnly?: boolean,
) {
  const field = qtyType === 'locked' ? 'locked' : qtyType === 'total' ? '(available + locked)' : 'available'
  if (lowStockOnly || qtyMin != null || qtyMax != null) {
    if (lowStockOnly) conditions.push(`${field} > 0`)
    if (qtyMin != null && Number.isFinite(qtyMin)) {
      conditions.push(`${field} >= ?`)
      params.push(qtyMin)
    }
    if (qtyMax != null && Number.isFinite(qtyMax)) {
      conditions.push(`${field} <= ?`)
      params.push(qtyMax)
    }
  }
}

function mapOmsInventoryRow(r: Record<string, unknown>) {
  return buildOmsWarehouseInventoryRow({
    id: r.id,
    sku: String(r.sku || ''),
    name: String(r.name || ''),
    spec: String(r.spec || ''),
    categoryPath: String(r.categoryPath || ''),
    ean: String(r.ean || ''),
    customerCode: String(r.customerCode || ''),
    customerName: String(r.customerName || ''),
    customerSku: String(r.customerSku || ''),
    warehouse: String(r.warehouse || ''),
    available: Number(r.available ?? 0),
    locked: Number(r.locked ?? 0),
    inTransit: Number(r.inTransit ?? 0),
    pendingShelving: Number(r.pendingShelving ?? 0),
    defective: Number(r.defective ?? 0),
    warningQty: Number(r.warningQty ?? 0),
    price: r.price != null ? Number(r.price) : null,
    stockSource: String(r.stockSource || 'own'),
  })
}

function mapCatalogInventoryRow(
  r: {
    id: bigint
    sku: string
    productName: string
    quantity: number
    unitPrice: unknown
    updatedAt: Date
  },
  customer?: { customerCode: string; customerName: string },
) {
  return buildCatalogHoldingInventoryRow({
    id: r.id,
    sku: r.sku,
    productName: r.productName,
    quantity: r.quantity,
    unitPrice: r.unitPrice,
    updatedAt: r.updatedAt,
    customerCode: customer?.customerCode,
    customerName: customer?.customerName,
  })
}

function mapCatalogPoolRow(r: {
  id: bigint
  sku: string
  productName: string
  spec?: string | null
  finalPrice?: unknown
  soldQty?: number | null
  visibleStockQty?: number | null
  inboundQty?: number | null
  purchaseQty?: number | null
  updatedAt?: Date
}) {
  const qty = remainingCatalogStock(r)
  return finalizeInventoryRow({
    id: `pool-${r.id}`,
    sku: r.sku,
    customerSku: catalogBaseSkuFromInternal(r.sku),
    productName: r.productName,
    spec: r.spec || '',
    category: '货盘',
    spu: '',
    barcode: '',
    customerCode: CATALOG_CUSTOMER_CODE,
    customerName: '平台货盘',
    supplierName: '平台货盘',
    warehouseCode: 'CATALOG',
    warehouseName: '货盘池',
    warehouseLabel: '货盘池 [TKL]',
    warehouseType: 'catalog',
    availableQty: qty,
    lockedQty: 0,
    totalQty: qty,
    sellableQty: qty,
    pendingOutboundQty: 0,
    inTransitQty: 0,
    pendingPutawayQty: 0,
    defectiveQty: 0,
    pendingDefectiveQty: 0,
    stagingQty: 0,
    pendingStagingQty: 0,
    pendingDestroyQty: 0,
    subInventoryQty: 0,
    outOfStockQty: qty <= 0 ? 1 : 0,
    alertQty: 0,
    lastInboundDate: '',
    referenceNo: '',
    inboundNo: '',
    putawayQty: 0,
    finalPrice: r.finalPrice != null ? Number(r.finalPrice) : null,
    dataSource: 'catalog' as const,
    dataSourceLabel: '货盘池·TKL',
    stockSource: 'catalog',
    sortKey: Number(r.updatedAt?.getTime?.() ?? 0),
  })
}

/** 平台货盘客户 TKL 的共享池库存（product_pricing 剩余可售） */
export async function fetchCatalogPoolRows(prisma: PrismaService, filters: MergedInventoryFilters) {
  const customerCode = filters.customerCode?.trim()
  if (customerCode && customerCode.toUpperCase() !== CATALOG_CUSTOMER_CODE) {
    return []
  }

  const and: Record<string, unknown>[] = [{ visibleOnOms: true }]
  const code = (filters.productCode || '').trim()
  if (code) {
    and.push(
      filters.exactSku
        ? { sku: code }
        : { OR: [{ sku: { contains: code } }, { productName: { contains: code } }] },
    )
  }

  const tokens = skuTokens(filters.skuCodes)
  if (tokens.length === 1) and.push({ sku: { contains: tokens[0] } })
  else if (tokens.length > 1) and.push({ OR: tokens.map((sku) => ({ sku: { contains: sku } })) })

  const where = and.length ? { AND: and } : {}
  const rows = await prisma.productPricing.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 5000,
  })

  let mapped = rows.map((r) => mapCatalogPoolRow(r))
  if (filters.lowStockOnly || filters.onlyAvailable) {
    mapped = mapped.filter((r) => r.availableQty > 0)
  }
  const qtyMin = filters.qtyMin
  const qtyMax = filters.qtyMax
  if (qtyMin != null && Number.isFinite(qtyMin)) {
    mapped = mapped.filter((r) => r.availableQty >= qtyMin)
  }
  if (qtyMax != null && Number.isFinite(qtyMax)) {
    mapped = mapped.filter((r) => r.availableQty <= qtyMax)
  }
  return mapped
}

function mapOmsProductRow(r: Record<string, unknown>) {
  const l = r.lengthCm != null ? Number(r.lengthCm) : null
  const w = r.widthCm != null ? Number(r.widthCm) : null
  const h = r.heightCm != null ? Number(r.heightCm) : null
  const wt = r.weightKg != null ? Number(r.weightKg) : null
  const statusRaw = String(r.productStatus || 'pending')
  const status =
    statusRaw === 'active' || statusRaw === '正式' ? 'active'
    : statusRaw === 'inactive' || statusRaw === '停用' ? 'inactive'
    : 'pending'
  const statusLabel =
    status === 'active' ? '正式产品'
    : status === 'inactive' ? '停用产品'
    : '待完善'
  const hasDimensions = l != null && w != null && h != null
  const internalSku = String(r.internalSku || '')
  const customer = resolveCustomerIdentity({
    sku: internalSku,
    customerCode: String(r.customerCode || ''),
    customerSku: String(r.customerSku || ''),
    customerName: String(r.customerName || ''),
  })
  return finalizeInventoryRow({
    id: `oms-${r.id}`,
    sku: internalSku,
    customerSku: customer.customerSku,
    spu: '',
    productName: String(r.name || ''),
    spec: String(r.spec || ''),
    category: String(r.category || ''),
    brand: '',
    barcode: String(r.outerBoxBarcode || ''),
    lengthCm: l,
    widthCm: w,
    heightCm: h,
    weightKg: wt,
    costRmb: r.cost != null ? Number(r.cost) : null,
    status,
    statusLabel,
    syncStatus: 'oms',
    receiptFlag: hasDimensions ? '已测量' : '新产品',
    hasDimensions,
    customerCode: customer.customerCode,
    customerName: customer.customerName,
    supplierName: customer.customerName,
    developerName: '',
    salesStatus: r.inCatalog ? '货盘可见' : 'OMS客户',
    orderableOnOms: Boolean(r.inCatalog),
    visibleOnOms: Boolean(r.inCatalog),
    finalPrice: r.price != null ? Number(r.price) : null,
    remark: String(r.customCode || ''),
    createdAt: null,
    updatedAt: null,
    dimLabel: hasDimensions ? `${l} x ${w} x ${h}` : '',
    weightLabel: wt != null ? wt.toFixed(3) : '',
    dataSource: 'oms' as const,
    dataSourceLabel: inventoryDataSourceLabel('oms', r.inCatalog ? 'catalog' : 'own'),
    sortKey: 0,
  })
}

export async function fetchOmsInventoryRows(prisma: PrismaService, filters: MergedInventoryFilters) {
  const conditions: string[] = ['1=1']
  const params: unknown[] = []

  const customerCode = filters.customerCode?.trim()
  if (customerCode) {
    conditions.push('(c.code LIKE ? OR c.name LIKE ?)')
    params.push(likeParam(customerCode), likeParam(customerCode))
  }

  const code = (filters.productCode || '').trim()
  if (code) {
    if (filters.exactSku) {
      conditions.push('(i.sku = ? OR i.customCode = ?)')
      params.push(code, code)
    } else {
      conditions.push('(i.sku LIKE ? OR i.name LIKE ? OR i.customCode LIKE ?)')
      params.push(likeParam(code), likeParam(code), likeParam(code))
    }
  }

  const tokens = skuTokens(filters.skuCodes)
  pushSkuFilter(conditions, params, 'i.sku', tokens, false)
  if (filters.barcode?.trim()) {
    conditions.push('i.ean LIKE ?')
    params.push(likeParam(filters.barcode.trim()))
  }
  if (filters.category?.trim()) {
    conditions.push('(i.categoryPath LIKE ? OR i.spec LIKE ?)')
    params.push(likeParam(filters.category.trim()), likeParam(filters.category.trim()))
  }

  if (filters.warehouseCodes?.length) {
    const terms = expandWarehouseSearchTerms(filters.warehouseCodes)
    const whConds = terms.map(() => '(i.warehouse LIKE ? OR LOWER(i.warehouse) = LOWER(?))')
    conditions.push(`(${whConds.join(' OR ')})`)
    for (const wh of terms) {
      params.push(likeParam(wh), wh)
    }
  }

  pushQtyFilter(
    conditions,
    params,
    'available',
    filters.qtyType,
    filters.qtyMin ?? null,
    filters.qtyMax ?? null,
    filters.lowStockOnly || filters.onlyAvailable,
  )

  const sql = `
    SELECT i.id, i.sku, i.name, i.available, i.locked, i.inTransit, i.warehouse,
           i.stockSource, i.spec, i.ean, i.categoryPath, i.pendingShelving,
           i.pendingOutbound, i.defective, i.warningQty, i.price,
           c.code AS customerCode, c.name AS customerName,
           p.customerSku AS customerSku
    FROM oms_inventoryitem i
    LEFT JOIN oms_customeraccount c ON c.id = i.customerId
    LEFT JOIN oms_product p ON p.internalSku = i.sku AND (p.customerId = i.customerId OR p.customerId IS NULL)
    WHERE ${conditions.join(' AND ')}
    ORDER BY i.sku ASC
    LIMIT 5000
  `
  try {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params)
    return rows.map(mapOmsInventoryRow)
  } catch (err) {
    console.warn('[inventory] OMS 库存读取失败，已跳过 OMS 数据源:', err)
    return []
  }
}

async function resolveErpCustomersByKeyword(prisma: PrismaService, keyword: string) {
  const kw = keyword.trim()
  if (!kw) return []
  const erpCustomers = await prisma.customer.findMany({
    where: {
      OR: [
        { customerCode: { contains: kw } },
        { customerName: { contains: kw } },
      ],
    },
    select: { id: true, customerCode: true, customerName: true },
    take: 100,
  })
  const codes = new Set(erpCustomers.map((c) => c.customerCode))
  try {
    const omsRows = await prisma.$queryRawUnsafe<{ code: string }[]>(
      'SELECT code FROM oms_customeraccount WHERE code LIKE ? OR name LIKE ? LIMIT 100',
      likeParam(kw),
      likeParam(kw),
    )
    for (const row of omsRows) {
      const code = String(row.code || '').trim()
      if (!code || codes.has(code)) continue
      const matched = await prisma.customer.findFirst({
        where: { customerCode: code },
        select: { id: true, customerCode: true, customerName: true },
      })
      if (matched) {
        erpCustomers.push(matched)
        codes.add(matched.customerCode)
      }
    }
  } catch {
    // OMS 表不可用时仅使用 ERP 客户
  }
  return erpCustomers
}

/** 货盘客户持有量：不受海外仓仓库筛选影响，始终并入库存查询 */
export async function fetchCatalogInventoryRows(prisma: PrismaService, filters: MergedInventoryFilters) {
  const and: Record<string, unknown>[] = []
  const customerCode = filters.customerCode?.trim()
  let customerMap = new Map<number, { customerCode: string; customerName: string }>()

  if (customerCode) {
    const customers = await resolveErpCustomersByKeyword(prisma, customerCode)
    if (!customers.length) return []
    and.push({ customerId: { in: customers.map((c) => c.id) } })
    customerMap = new Map(customers.map((c) => [Number(c.id), c]))
  }

  const code = (filters.productCode || '').trim()
  if (code) {
    and.push(
      filters.exactSku
        ? { sku: code }
        : { OR: [{ sku: { contains: code } }, { productName: { contains: code } }] },
    )
  }

  const tokens = skuTokens(filters.skuCodes)
  if (tokens.length === 1) and.push({ sku: { contains: tokens[0] } })
  else if (tokens.length > 1) and.push({ OR: tokens.map((sku) => ({ sku: { contains: sku } })) })

  if (filters.lowStockOnly || filters.onlyAvailable) {
    and.push({ quantity: { gt: 0 } })
  }

  const qtyMin = filters.qtyMin
  const qtyMax = filters.qtyMax
  if ((qtyMin != null && Number.isFinite(qtyMin)) || (qtyMax != null && Number.isFinite(qtyMax))) {
    const qty: { gte?: number; lte?: number } = {}
    if (qtyMin != null && Number.isFinite(qtyMin)) qty.gte = qtyMin
    if (qtyMax != null && Number.isFinite(qtyMax)) qty.lte = qtyMax
    and.push({ quantity: qty })
  }

  const where = and.length ? { AND: and } : {}
  const rows = await prisma.customerSkuInventory.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 5000,
  })

  if (!customerMap.size && rows.length) {
    const ids = [...new Set(rows.map((r) => r.customerId))]
    const customers = await prisma.customer.findMany({
      where: { id: { in: ids } },
      select: { id: true, customerCode: true, customerName: true },
    })
    customerMap = new Map(customers.map((c) => [Number(c.id), c]))
  }

  const mapped = rows.map((r) => mapCatalogInventoryRow(r, customerMap.get(Number(r.customerId))))
  return attachCatalogPurchaseStats(prisma, mapped)
}

export async function attachCatalogPurchaseStats<T extends { sku: string; customerCode: string }>(
  prisma: PrismaService,
  rows: T[],
) {
  if (!rows.length) return rows
  const skus = [...new Set(rows.map((r) => r.sku))]
  const orders = await prisma.omsCatalogOrder.findMany({
    where: { sku: { in: skus } },
    select: { sku: true, customerCode: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
  const statsMap = new Map<string, { purchaseOrderCount: number; lastPurchaseAt: Date | null }>()
  for (const o of orders) {
    const key = `${o.customerCode || ''}::${o.sku}`
    const prev = statsMap.get(key) || { purchaseOrderCount: 0, lastPurchaseAt: null }
    prev.purchaseOrderCount += 1
    if (!prev.lastPurchaseAt) prev.lastPurchaseAt = o.createdAt
    statsMap.set(key, prev)
  }
  return rows.map((r) => {
    const stats = statsMap.get(`${r.customerCode}::${r.sku}`)
    return {
      ...r,
      purchaseOrderCount: stats?.purchaseOrderCount ?? 0,
      lastPurchaseAt: stats?.lastPurchaseAt ?? null,
    }
  })
}

export async function fetchOmsProductRows(prisma: PrismaService, filters: MergedSkuFilters) {
  const conditions: string[] = ['1=1']
  const params: unknown[] = []

  const customerCode = filters.customerCode?.trim()
  if (customerCode) {
    conditions.push('(c.code LIKE ? OR c.name LIKE ?)')
    params.push(likeParam(customerCode), likeParam(customerCode))
  }

  const title = (filters.title || '').trim()
  if (title) {
    conditions.push('(p.name LIKE ? OR p.internalSku LIKE ? OR p.spec LIKE ?)')
    params.push(likeParam(title), likeParam(title), likeParam(title))
  }

  const tokens = skuTokens(filters.skuCodes)
  pushSkuFilter(conditions, params, 'p.internalSku', tokens, false)
  if (filters.barcode?.trim()) {
    conditions.push('p.outerBoxBarcode LIKE ?')
    params.push(likeParam(filters.barcode.trim()))
  }
  if (filters.category?.trim()) {
    conditions.push('(p.category LIKE ? OR p.categoryPath LIKE ?)')
    params.push(likeParam(filters.category.trim()), likeParam(filters.category.trim()))
  }

  const statusFilter = (filters.statusFilter || 'all').trim()
  if (statusFilter === 'active') {
    conditions.push("(p.productStatus IN ('active', '正式', '正式产品'))")
  } else if (statusFilter === 'inactive') {
    conditions.push("(p.productStatus IN ('inactive', '停用', '停用产品'))")
  } else if (statusFilter === 'pending') {
    conditions.push("(p.productStatus IN ('pending', '待完善', 'draft'))")
  } else if (statusFilter === 'missing_dims') {
    conditions.push('(p.lengthCm IS NULL OR p.widthCm IS NULL OR p.heightCm IS NULL OR p.lengthCm = 0)')
  }

  const costMin = filters.costMin
  const costMax = filters.costMax
  if (costMin != null && Number.isFinite(costMin)) {
    conditions.push('p.cost >= ?')
    params.push(costMin)
  }
  if (costMax != null && Number.isFinite(costMax)) {
    conditions.push('p.cost <= ?')
    params.push(costMax)
  }

  const sql = `
    SELECT p.*, c.code AS customerCode, c.name AS customerName
    FROM oms_product p
    LEFT JOIN oms_customeraccount c ON c.id = p.customerId
    WHERE ${conditions.join(' AND ')}
    ORDER BY p.internalSku ASC
    LIMIT 5000
  `
  try {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params)
    return rows.map(mapOmsProductRow)
  } catch {
    return []
  }
}

export function mergePaginate(
  lists: Array<Array<{ sortKey?: number; sku?: string; dataSource?: string }>>,
  page: number,
  pageSize: number,
) {
  const merged = lists.flat().sort((a, b) => {
    const skuCmp = String(a.sku || '').localeCompare(String(b.sku || ''), 'zh-CN')
    if (skuCmp !== 0) return skuCmp
    const srcCmp =
      (SOURCE_SORT[String(a.dataSource || '')] ?? 9) - (SOURCE_SORT[String(b.dataSource || '')] ?? 9)
    if (srcCmp !== 0) return srcCmp
    return (b.sortKey ?? 0) - (a.sortKey ?? 0)
  })
  const total = merged.length
  const items = finalizeInventoryRows(merged.slice((page - 1) * pageSize, page * pageSize))
  return { items, total }
}
