import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
type Holding = { sku: string; quantity: number; productName?: string; unitPrice?: number | null }

/** Replayed or reordered notifications must read the current ERP holding. */
export async function applyCatalogReclaimSnapshot(prisma: PrismaClient, customerId: string, sku: string, load: () => Promise<Holding[]>) {
  if (!customerId || !sku.trim()) throw new Error('客户或商品信息不完整，请核对收回同步')
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM oms_customeraccount WHERE id = ${customerId} FOR UPDATE`
    const holdings = await load()
    if (!Array.isArray(holdings)) throw new Error('持有来源读取不完整，请重试原收回操作')
    const matched = holdings.filter(item => item.sku === sku)
    if (matched.length > 1 || matched.some(item => !Number.isSafeInteger(item.quantity) || item.quantity < 0)) throw new Error('持有来源需要核对，请重试原收回同步')
    const canonical = matched[0], quantity = canonical?.quantity ?? 0
    const rows = await tx.inventoryItem.findMany({ where: { customerId, sku, stockSource: 'catalog' }, orderBy: { id: 'asc' } })
    if (rows[0]) {
      // Keep reservations, shipped history and global catalog product data intact.
      await tx.inventoryItem.update({ where: { id: rows[0].id }, data: { available: 0, locked: quantity } })
      // Preserve historical reservations/shipped fields on every old row, while
      // exposing the single authoritative free holding only once across aliases.
      for (const duplicate of rows.slice(1)) await tx.inventoryItem.update({ where: { id: duplicate.id }, data: { available: 0, locked: 0 } })
    } else if (quantity > 0) {
      const id = `csi-${createHash('sha256').update(JSON.stringify([customerId, sku])).digest('hex').slice(0, 40)}`
      await tx.inventoryItem.create({ data: { id, customerId, sku, name: canonical?.productName || sku, image: '', available: 0, locked: quantity, inTransit: 0, safetyStock: 0, spec: '', customCode: null, ean: null, warehouse: 'jhb1', pendingShelving: 0, pendingOutbound: 0, defective: 0, shipped: 0, warningQty: 0, price: Number(canonical?.unitPrice) || 0, stockSource: 'catalog' } })
    }
    return { quantity }
  }, { timeout: 30000 })
}
