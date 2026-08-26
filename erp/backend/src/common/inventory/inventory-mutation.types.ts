import type { PrismaService } from '../prisma/prisma.service'

/** Prisma 事务客户端类型 */
export type InventoryTx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0]

export type WarehouseDeltaMeta = {
  changeType: string
  remark?: string
  referenceNo?: string
}

export type WarehouseDeltaParams = WarehouseDeltaMeta & {
  productId: bigint
  sku: string
  warehouseCode: string
  diff: number
  operatorId?: number
}

export type LocationStockParams = {
  productId: bigint
  sku: string
  warehouseCode: string
  locationId: bigint
  locationCode: string
  qty: number
  batchNo?: string | null
  inboundNo?: string | null
}

export type LocationDeductLine = {
  inventoryLocationId: bigint
  qty: number
}

export type StocktakeAdjustParams = {
  productId: bigint
  sku: string
  warehouseCode: string
  locationId: bigint
  locationCode: string
  targetQty: number
  operatorId?: number
  referenceNo: string
}

export type ShipDeductParams = {
  productId: bigint
  sku: string
  warehouseCode: string
  qty: number
  referenceNo: string
  operatorId?: number
  remark?: string
}

export type RestoreLocationParams = {
  productId: bigint
  sku: string
  warehouseCode: string
  locationId: bigint
  locationCode: string
  inventoryLocationId?: bigint | null
  qty: number
}
