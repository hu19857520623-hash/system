import { BadRequestException } from '@nestjs/common'
import { createHash } from 'crypto'
import { resolveBillingDimensions, numDim } from '../../common/product-dimension.util'

export function shipmentBillingDimensions(product: any) {
  return resolveBillingDimensions({ lengthCm: numDim(product?.lengthCm), widthCm: numDim(product?.widthCm), heightCm: numDim(product?.heightCm),
    measuredLengthCm: numDim(product?.measuredLengthCm), measuredWidthCm: numDim(product?.measuredWidthCm), measuredHeightCm: numDim(product?.measuredHeightCm) })
}

/** Includes cost inputs as well as row state; a same-millisecond edit still changes the version. */
export function shipmentSeaFreightVersion(order: any, products: any[]) {
  const byId = new Map(products.map(product => [String(product.id), product]))
  const lines = (order.items || []).map((item: any) => ({ id: String(item.id), productId: String(item.productId), sku: item.sku,
    expectedQty: Number(item.expectedQty), actualQty: item.actualQty == null ? null : Number(item.actualQty), putawayQty: Number(item.putawayQty || 0),
    seaFreightPerUnit: Number(item.seaFreightPerUnit || 0), costRmb: Number(item.costRmb || 0), domesticFeePerUnit: Number(item.domesticFeePerUnit || 0),
    dimensions: shipmentBillingDimensions(byId.get(String(item.productId))) })).sort((a: any, b: any) => a.id.localeCompare(b.id))
  return createHash('sha256').update(JSON.stringify({ id: String(order.id), status: order.status, remark: order.remark || '', source: order.sourceWarehouseCode || '', warehouse: order.warehouseCode, lines })).digest('hex')
}

export function assertErpShipment(order: any) {
  if (!order.sourceWarehouseCode || order.omsCustomerCode) throw new BadRequestException('此单不是 ERP 中转仓发运单，请在对应来源的入库管理中处理')
}
