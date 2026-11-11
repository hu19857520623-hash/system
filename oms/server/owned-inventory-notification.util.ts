import { Prisma, type PrismaClient } from '@prisma/client'
import { applyErpInventoryView, InventoryWriteError } from './inventory-write.util.js'
import type { fetchErpInventoryView } from './erpClient.js'

type View = Awaited<ReturnType<typeof fetchErpInventoryView>>
export function inventoryWarehouse(value: string) {
  const code = String(value || '').trim().toUpperCase()
  const wms = code.match(/^WMS-(JHB|CPT|DBN)-(\d+)$/)
  if (wms) return `WMS-${wms[1]}-${String(Number(wms[2])).padStart(2, '0')}`
  return ({ JHB: 'WMS-JHB-01', JHB1: 'WMS-JHB-01', JHB3: 'WMS-JHB-03', CPT1: 'WMS-CPT-01', CPT2: 'WMS-CPT-02', DBN: 'WMS-DBN-01' } as Record<string, string>)[code] || code
}

/** The event only wakes a current, complete customer/warehouse read. Never apply its quantities. */
export async function applyOwnedInventoryNotification(db: PrismaClient, customerId: string, customerCode: string, warehouseCode: string,
  load: (code: string, warehouse: string) => Promise<View>) {
  const warehouse = inventoryWarehouse(warehouseCode)
  if (!customerId || !customerCode.trim() || !warehouse) throw new InventoryWriteError('库存通知缺少客户或仓库，请重试原同步', 400)
  return db.$transaction(async tx => {
    const account = await tx.$queryRaw<{ code: string }[]>`SELECT code FROM oms_customeraccount WHERE id = ${customerId} FOR UPDATE`
    if (account[0]?.code !== customerCode) throw new InventoryWriteError('库存通知客户归属已变化，请重新同步', 409)
    const view = await load(customerCode, warehouse)
    if (!view || view.customerCode !== customerCode || inventoryWarehouse(view.warehouseCode) !== warehouse || !Array.isArray(view.items)
      || !Number.isSafeInteger(view.total) || view.items.length !== view.total
      || view.items.some(item => !item || !['owned', 'catalog'].includes(item.stockSource) || inventoryWarehouse(item.warehouseCode) !== warehouse)) throw new InventoryWriteError('ERP库存范围返回不完整，请稍后重试同步', 502)
    return applyErpInventoryView(tx, customerId, warehouse, view.items.filter(item => item.stockSource === 'owned'), 'owned')
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 60000 })
}
