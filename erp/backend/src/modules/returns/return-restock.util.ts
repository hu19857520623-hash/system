import { BadRequestException } from '@nestjs/common'
import type { InventoryTx } from '../../common/inventory/inventory-mutation.types'
import type { InventoryMutationService } from '../../common/inventory/inventory-mutation.service'
import { parseOmsCustomerCodeFromRemark } from '../../common/oms-sync-meta.util'
import { catalogSkuLookupKeys, isCatalogInternalSku } from '../../common/catalog-customer.util'
import type { Product, WarehouseLocation } from '@prisma/client'

export type ReturnStockLine = { sku: string; qty: number; locationCode: string }
export type ReturnProcessInput = { processResult?: string; processRemark?: string; clientRequestId?: string; warehouseCode?: string; stockLines?: ReturnStockLine[] }
type ReturnForStock = { id: bigint; returnNo: string; customerId: bigint; omsCustomerCode: string | null; receivedQty: number | null; items: { sku: string; quantity: number }[] }
type StockLog = { referenceNo: string | null; sku: string; changeQty: number }

export function returnRestockProgress(row: Pick<ReturnForStock, 'returnNo' | 'receivedQty' | 'items'>, logs: StockLog[]) {
  const restockedBySku: Record<string, number> = Object.create(null)
  for (const log of logs) if (log.referenceNo === row.returnNo) {
    const candidates = [...new Set(row.items.filter(item => item.sku === log.sku || (isCatalogInternalSku(item.sku) && catalogSkuLookupKeys(item.sku).includes(log.sku))).map(item => item.sku))]
    if (candidates.length !== 1) throw new BadRequestException('退件库存流水与商品明细对应不唯一，请核对后继续返库')
    const sku = candidates[0]
    restockedBySku[sku] = (restockedBySku[sku] || 0) + log.changeQty
  }
  const restockedQty = Object.values(restockedBySku).reduce((sum, qty) => sum + qty, 0)
  const receivedQty = row.receivedQty ?? row.items.reduce((sum, item) => sum + item.quantity, 0)
  return { restockedQty, restockedBySku, remainingRestockQty: Math.max(0, receivedQty - restockedQty) }
}

export function returnProcessFingerprint(body: ReturnProcessInput, processResult: string) {
  return JSON.stringify({ processResult, processRemark: String(body.processRemark || '').trim(),
    warehouseCode: String(body.warehouseCode || '').trim(),
    stockLines: (Array.isArray(body.stockLines) ? body.stockLines : []).map(line => ({
      sku: String(line?.sku || '').trim(), qty: Number(line?.qty), locationCode: String(line?.locationCode || '').trim().toUpperCase(),
    })).sort((a, b) => a.sku.localeCompare(b.sku) || a.locationCode.localeCompare(b.locationCode) || a.qty - b.qty),
  })
}

export async function restockReturnToLocations(tx: InventoryTx, row: ReturnForStock, body: ReturnProcessInput,
  inventoryMutation: InventoryMutationService, userId: number) {
  const warehouseCode = String(body.warehouseCode || '').trim()
  if (!warehouseCode) throw new BadRequestException('请选择实际返库仓库')
  const warehouse = await tx.warehouse.findUnique({ where: { warehouseCode } })
  if (!warehouse || warehouse.warehouseType !== 'wms' || warehouse.status !== 1) throw new BadRequestException('返库仓库不存在、已停用或不是海外仓')
  const lines = Array.isArray(body.stockLines) ? body.stockLines : []
  if (!lines.length) throw new BadRequestException('请填写本次上架的 SKU、实际库位和数量')
  const logs = await tx.inventoryLog.findMany({ where: { referenceNo: row.returnNo, changeType: 'return_restock' }, select: { referenceNo: true, sku: true, changeQty: true } })
  const before = returnRestockProgress(row, logs)
  const expected = new Map<string, number>()
  for (const item of row.items) expected.set(item.sku, (expected.get(item.sku) || 0) + item.quantity)
  const batch = new Map<string, number>()
  const normalized = lines.map(line => {
    const sku = String(line?.sku || '').trim(), qty = Number(line?.qty), locationCode = String(line?.locationCode || '').trim().toUpperCase()
    if (!expected.has(sku)) throw new BadRequestException('上架 SKU 不属于当前退件单，请刷新核对')
    if (!Number.isSafeInteger(qty) || qty <= 0) throw new BadRequestException(`${sku} 上架数量须为大于零的整数`)
    if (!locationCode) throw new BadRequestException(`请填写 ${sku} 的实际上架库位`)
    batch.set(sku, (batch.get(sku) || 0) + qty)
    return { sku, qty, locationCode }
  })
  const batchQty = normalized.reduce((sum, line) => sum + line.qty, 0)
  if (!Number.isSafeInteger(batchQty) || batchQty > before.remainingRestockQty) throw new BadRequestException(`上架数量超出待返库数量，当前剩余 ${before.remainingRestockQty} 件`)
  for (const [sku, qty] of batch) if (qty + (before.restockedBySku[sku] || 0) > expected.get(sku)!) throw new BadRequestException(`${sku} 累计上架数量超出退件明细数量`)

  const lookup = [...new Set([...batch.keys()].flatMap(sku => isCatalogInternalSku(sku) ? catalogSkuLookupKeys(sku) : [sku]))]
  const products = await tx.product.findMany({ where: { sku: { in: lookup } } })
  const customer = await tx.customer.findUnique({ where: { id: row.customerId }, select: { customerCode: true, status: true } })
  if (!customer || customer.status !== 1) throw new BadRequestException('退件所属客户不存在或已停用')
  const code = row.omsCustomerCode || customer.customerCode
  if (code !== customer.customerCode) throw new BadRequestException('退件客户信息不一致，请联系管理员核对')
  const productBySku = new Map<string, Product>()
  const catalogSkus = new Set<string>()
  for (const sku of [...batch.keys()].sort()) {
    const candidates = products.filter(product => product.sku === sku || (isCatalogInternalSku(sku) && catalogSkuLookupKeys(sku).includes(product.sku)))
    if (candidates.length > 1) throw new BadRequestException(`${sku} 对应多份仓内商品档案，请先核对货盘编码`)
    const product = candidates[0]
    if (!product) throw new BadRequestException(`${sku} 尚未建立仓内商品档案，请先同步商品资料`)
    productBySku.set(sku, product)
    const owner = parseOmsCustomerCodeFromRemark(product.remark)
    if (isCatalogInternalSku(sku)) {
      if (owner && owner !== 'TKL') throw new BadRequestException(`${sku} 对应其它客户私有商品，不能作为共享货盘返库`)
      const owned = await tx.customerSkuInventory.findUnique({ where: { customerId_sku: { customerId: row.customerId, sku } } })
      const purchase = owned || await tx.omsCatalogOrder.findFirst({ where: { customerId: row.customerId, sku, status: 'confirmed' }, select: { id: true } })
      if (!purchase) throw new BadRequestException(`${sku} 未找到该客户的货盘持有或采购记录，请核对后再返库`)
      catalogSkus.add(sku)
    } else if (owner !== code) throw new BadRequestException(`${sku} 不属于该退件客户，请核对商品编码`)
  }
  const resolved: (ReturnStockLine & { location: WarehouseLocation; product: Product })[] = []
  for (const line of normalized) {
    const location = await tx.warehouseLocation.findFirst({ where: { warehouseCode, locationCode: line.locationCode, status: 'available' } })
    if (!location) throw new BadRequestException(`库位 ${line.locationCode} 不可用或不属于所选返库仓库`)
    resolved.push({ ...line, location, product: productBySku.get(line.sku)! })
  }
  // Serialize against other return/inventory writers, including creation of a missing warehouse balance.
  for (const product of [...products].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    await tx.$queryRaw`SELECT id FROM product WHERE id = ${product.id} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM inventory WHERE product_id = ${product.id} AND warehouse_code = ${warehouseCode} FOR UPDATE`
  }
  for (const line of resolved) {
    const current = await tx.inventory.findUnique({ where: { productId_warehouseCode: { productId: line.product.id, warehouseCode } } })
    await inventoryMutation.addLocationStock(tx, { productId: line.product.id, sku: line.product.sku, warehouseCode,
      locationId: line.location.id, locationCode: line.location.locationCode, qty: line.qty, batchNo: `RETURN-${row.id}`,
      costRmb: line.product.costRmb == null ? undefined : Number(line.product.costRmb),
      seaFreightPerUnit: line.product.seaFreightPerUnit == null ? undefined : Number(line.product.seaFreightPerUnit),
      domesticFeePerUnit: line.product.domesticFeePerUnit == null ? undefined : Number(line.product.domesticFeePerUnit),
      unitCostRmb: current?.avgCostRmb == null ? undefined : Number(current.avgCostRmb),
    }, { changeType: 'return_restock', referenceNo: row.returnNo, operatorId: userId, remark: `退件上架：${line.location.locationCode}` })
    if (catalogSkus.has(line.sku)) await tx.customerSkuInventory.upsert({
      where: { customerId_sku: { customerId: row.customerId, sku: line.sku } },
      create: { customerId: row.customerId, sku: line.sku, productName: line.product.productName, quantity: line.qty },
      update: { quantity: { increment: line.qty } },
    })
  }
  return { batchQty, stockLines: normalized, restockedQty: before.restockedQty + batchQty, remainingRestockQty: before.remainingRestockQty - batchQty }
}
