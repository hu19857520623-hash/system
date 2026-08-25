/**
 * ERP / OMS 库存查询统一字段映射。
 * 两套系统合并展示时使用同一套 customer* / warehouse* / qty* / dataSourceLabel 规则。
 */

import { parseOmsCustomerCodeFromRemark, parseOmsProductMeta } from './oms-sync-meta.util'
import {
  CATALOG_CUSTOMER_CODE,
  catalogBaseSkuFromInternal,
  isCatalogInternalSku,
} from './catalog-customer.util'
import { deriveCustomerCodeFromInternalSku, deriveCustomerSkuFromInternalSku } from './sku-code.util'
import {
  JHB_WAREHOUSE_CODE,
  JHB_WAREHOUSE_NAME,
  formatJhbWarehouseLabel,
  normalizeToJhbWarehouseCode,
} from './warehouse-display.util'

export type InventoryRowSource = 'erp' | 'oms' | 'catalog'

export type ResolvedCustomerIdentity = {
  customerCode: string
  customerSku: string
  customerName: string
}

export type UnifiedWarehouseFields = {
  warehouseCode: string
  warehouseName: string
  warehouseLabel: string
  warehouseType: string
}

export type UnifiedQuantityFields = {
  availableQty: number
  lockedQty: number
  totalQty: number
  sellableQty: number
  pendingOutboundQty: number
  inTransitQty: number
  pendingPutawayQty: number
  defectiveQty: number
  pendingDefectiveQty: number
  stagingQty: number
  pendingStagingQty: number
  pendingDestroyQty: number
  subInventoryQty: number
  outOfStockQty: number
}

/** 客户代码 / 客户 SKU / 客户名称 — ERP 与 OMS 共用解析规则 */
export function resolveCustomerIdentity(input: {
  sku: string
  customerCode?: string | null
  customerSku?: string | null
  customerName?: string | null
  productRemark?: string | null
  fallbackSupplierCode?: string | null
  fallbackSupplierName?: string | null
  customerNameByCode?: ReadonlyMap<string, string>
}): ResolvedCustomerIdentity {
  const sku = String(input.sku || '').trim()
  if (isCatalogInternalSku(sku)) {
    const customerCode = CATALOG_CUSTOMER_CODE
    return {
      customerCode,
      customerSku: catalogBaseSkuFromInternal(sku),
      customerName:
        input.customerNameByCode?.get(customerCode)
        || input.customerName?.trim()
        || '平台货盘',
    }
  }
  const meta = parseOmsProductMeta(input.productRemark)
  const fromRemark = parseOmsCustomerCodeFromRemark(input.productRemark)
  const fromRow = String(input.customerCode || '').trim()
  const skuCandidate = deriveCustomerCodeFromInternalSku(sku)
  const fromSku =
    skuCandidate && input.customerNameByCode?.has(skuCandidate.toUpperCase())
      ? skuCandidate
      : ''
  const customerCode =
    fromRemark || fromRow || fromSku

  let customerSku = String(input.customerSku || meta.customerSku || '').trim()
  if (!customerSku) customerSku = deriveCustomerSkuFromInternalSku(sku, customerCode)
  if (!customerSku && !customerCode) customerSku = sku
  if (!customerSku && fromRemark && sku.toUpperCase().startsWith(`${fromRemark.toUpperCase()}-`)) {
    customerSku = sku.slice(fromRemark.length + 1)
  }

  const mappedName =
    customerCode && input.customerNameByCode?.get(customerCode.toUpperCase())
  const customerName =
    mappedName
    || String(input.customerName || '').trim()

  return { customerCode, customerSku, customerName }
}

/** JHB 海外仓统一仓库字段（OMS jhb1 / ERP WMS-JHB-01 等别名归一） */
export function resolveJhbWarehouseFields(rawCode?: string | null, warehouseName?: string | null): UnifiedWarehouseFields {
  const warehouseCode = normalizeToJhbWarehouseCode(rawCode)
  const name =
    warehouseCode === JHB_WAREHOUSE_CODE
      ? JHB_WAREHOUSE_NAME
      : (warehouseName?.trim() || String(rawCode || '').trim() || JHB_WAREHOUSE_NAME)
  return {
    warehouseCode,
    warehouseName: name,
    warehouseLabel: formatJhbWarehouseLabel(rawCode, name),
    warehouseType: warehouseCode === JHB_WAREHOUSE_CODE ? 'wms' : 'logistics',
  }
}

/** 数量字段统一命名 */
export function buildInventoryQuantityFields(input: {
  available: number
  locked?: number
  inTransit?: number
  pendingPutaway?: number
  defective?: number
}): UnifiedQuantityFields {
  const availableQty = Number(input.available) || 0
  const lockedQty = Number(input.locked) || 0
  return {
    availableQty,
    lockedQty,
    totalQty: availableQty + lockedQty,
    sellableQty: availableQty,
    pendingOutboundQty: lockedQty,
    inTransitQty: Number(input.inTransit) || 0,
    pendingPutawayQty: Number(input.pendingPutaway) || 0,
    defectiveQty: Number(input.defective) || 0,
    pendingDefectiveQty: 0,
    stagingQty: 0,
    pendingStagingQty: 0,
    pendingDestroyQty: 0,
    subInventoryQty: 0,
    outOfStockQty: availableQty <= 0 ? 1 : 0,
  }
}

/** 来源标签 — 合并列表统一文案 */
export function inventoryDataSourceLabel(
  dataSource: InventoryRowSource,
  stockSource?: string | null,
): string {
  if (dataSource === 'erp') return '海外仓实收'
  if (dataSource === 'oms') {
    return stockSource === 'catalog' ? 'OMS·货盘库存' : 'OMS·客户库存'
  }
  return '货盘持有'
}

/** 补齐 customerName / supplierName 镜像，避免前端两套字段不一致 */
export function finalizeInventoryRow<T extends Record<string, unknown>>(row: T): T & {
  customerName: string
  supplierName: string
} {
  const customerName = String(row.customerName ?? '')
  const supplierName = String(row.supplierName ?? '')
  return {
    ...row,
    customerName,
    supplierName,
  }
}

export function finalizeInventoryRows<T extends Record<string, unknown>>(rows: T[]) {
  return rows.map((r) => finalizeInventoryRow(r))
}

export type ErpWarehouseRowInput = {
  id: number
  sku: string
  productId: number
  productName: string
  spec: string
  category: string
  spu: string
  barcode: string
  productRemark?: string | null
  rawWarehouseCode: string
  warehouseName?: string | null
  available: number
  locked: number
  inTransit: number
  pendingPutaway: number
  fallbackSupplierCode?: string | null
  fallbackSupplierName?: string | null
  customerNameByCode?: ReadonlyMap<string, string>
  finalPrice?: number | null
  lastInboundDate?: string
  referenceNo?: string
  inboundNo?: string
  putawayQty?: number
  alertQty?: number
  sortKey?: number
}

export function buildErpWarehouseInventoryRow(input: ErpWarehouseRowInput) {
  const customer = resolveCustomerIdentity({
    sku: input.sku,
    productRemark: input.productRemark,
    fallbackSupplierCode: input.fallbackSupplierCode,
    fallbackSupplierName: input.fallbackSupplierName,
    customerNameByCode: input.customerNameByCode,
  })
  const warehouse = resolveJhbWarehouseFields(input.rawWarehouseCode, input.warehouseName)
  const qty = buildInventoryQuantityFields({
    available: input.available,
    locked: input.locked,
    inTransit: input.inTransit,
    pendingPutaway: input.pendingPutaway,
  })

  return finalizeInventoryRow({
    id: input.id,
    sku: input.sku,
    productId: input.productId,
    productName: input.productName,
    spec: input.spec,
    category: input.category,
    spu: input.spu,
    barcode: input.barcode,
    customerCode: customer.customerCode,
    customerSku: customer.customerSku,
    customerName: customer.customerName,
    supplierName: input.fallbackSupplierName || '',
    ...warehouse,
    ...qty,
    alertQty: input.alertQty ?? 0,
    lastInboundDate: input.lastInboundDate || '',
    referenceNo: input.referenceNo || '',
    inboundNo: input.inboundNo || '',
    putawayQty: input.putawayQty ?? 0,
    finalPrice: input.finalPrice ?? null,
    dataSource: 'erp' as const,
    dataSourceLabel: inventoryDataSourceLabel('erp'),
    sortKey: input.sortKey ?? input.id,
  })
}

export type OmsWarehouseRowInput = {
  id: unknown
  sku: string
  name: string
  spec?: string | null
  categoryPath?: string | null
  ean?: string | null
  customerCode?: string | null
  customerName?: string | null
  customerSku?: string | null
  warehouse?: string | null
  available: number
  locked: number
  inTransit?: number
  pendingShelving?: number
  defective?: number
  warningQty?: number
  price?: number | null
  stockSource?: string | null
}

export function buildOmsWarehouseInventoryRow(input: OmsWarehouseRowInput) {
  const customer = resolveCustomerIdentity({
    sku: input.sku,
    customerCode: input.customerCode,
    customerSku: input.customerSku,
    customerName: input.customerName,
  })
  const warehouse = resolveJhbWarehouseFields(input.warehouse)
  const qty = buildInventoryQuantityFields({
    available: input.available,
    locked: input.locked,
    inTransit: input.inTransit,
    pendingPutaway: input.pendingShelving,
    defective: input.defective,
  })
  const stockSource = String(input.stockSource || 'own')

  return finalizeInventoryRow({
    id: `oms-${input.id}`,
    sku: input.sku,
    customerCode: customer.customerCode,
    customerSku: customer.customerSku,
    customerName: customer.customerName,
    supplierName: customer.customerName,
    productName: String(input.name || ''),
    spec: String(input.spec || ''),
    category: String(input.categoryPath || ''),
    spu: '',
    barcode: String(input.ean || ''),
    ...warehouse,
    ...qty,
    alertQty: Number(input.warningQty) || 0,
    lastInboundDate: '',
    referenceNo: '',
    inboundNo: '',
    putawayQty: 0,
    finalPrice: input.price != null ? Number(input.price) : null,
    dataSource: 'oms' as const,
    dataSourceLabel: inventoryDataSourceLabel('oms', stockSource),
    stockSource,
    sortKey: omsRowSortKey(input.id),
  })
}

export type CatalogHoldingRowInput = {
  id: bigint | number | string
  sku: string
  productName: string
  quantity: number
  unitPrice?: unknown
  updatedAt?: Date | null
  customerCode?: string
  customerName?: string
}

export function buildCatalogHoldingInventoryRow(input: CatalogHoldingRowInput) {
  const customer = resolveCustomerIdentity({
    sku: input.sku,
    customerCode: input.customerCode,
    customerName: input.customerName,
    customerSku: catalogBaseSkuFromInternal(input.sku),
  })
  const qty = buildInventoryQuantityFields({ available: input.quantity, locked: 0 })

  return finalizeInventoryRow({
    id: `catalog-${input.id}`,
    sku: input.sku,
    customerCode: customer.customerCode,
    customerSku: customer.customerSku || catalogBaseSkuFromInternal(input.sku),
    customerName: customer.customerName,
    supplierName: customer.customerName,
    productName: input.productName,
    spec: '',
    category: '货盘',
    spu: '',
    barcode: '',
    warehouseCode: 'CATALOG',
    warehouseName: '货盘持有',
    warehouseLabel: '货盘持有 [客户申购]',
    warehouseType: 'catalog',
    ...qty,
    alertQty: 0,
    lastInboundDate: '',
    referenceNo: '',
    inboundNo: '',
    putawayQty: 0,
    finalPrice: input.unitPrice != null ? Number(input.unitPrice) : null,
    dataSource: 'catalog' as const,
    dataSourceLabel: inventoryDataSourceLabel('catalog'),
    stockSource: 'catalog',
    sortKey: Number(input.updatedAt?.getTime?.() ?? 0),
  })
}

function omsRowSortKey(id: unknown) {
  const s = String(id ?? '')
  const n = Number(s.replace(/\D/g, ''))
  if (Number.isFinite(n) && n > 0) return n
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0
  return hash || 1
}
