import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'

/** Absolute ERP holding balance, safe to replay after a lost webhook acknowledgement. */
export async function applyCatalogReturnSnapshot(prisma: PrismaClient, customerId: string, line: { sku: string; holdingQty?: number }, warehouse: string) {
  const sku = String(line.sku || '').trim(), qty = Number(line.holdingQty)
  if (!sku || !Number.isSafeInteger(qty) || qty < 0) return false
  const existing = await prisma.inventoryItem.findFirst({ where: { customerId, sku, stockSource: 'catalog' } })
  if (existing) {
    await prisma.inventoryItem.update({ where: { id: existing.id }, data: { available: 0, locked: qty } })
    return true
  }
  if (qty === 0) return true
  const pool = await prisma.inventoryItem.findFirst({ where: { sku, stockSource: 'catalog', OR: [{ customerId: null }, { customerId: 'tkl' }] } })
  const product = await prisma.product.findFirst({ where: { internalSku: sku, inCatalog: true } })
  const id = 'erp-rt-hold-' + createHash('sha256').update(JSON.stringify([customerId, sku])).digest('hex').slice(0, 32)
  await prisma.inventoryItem.upsert({ where: { id }, update: { available: 0, locked: qty }, create: {
    id, customerId, sku, name: product?.name || pool?.name || sku, image: product?.image || pool?.image || '',
    available: 0, locked: qty, inTransit: 0, safetyStock: 0, spec: product?.spec || pool?.spec || '',
    customCode: product?.customCode ?? pool?.customCode ?? null, ean: null, warehouse,
    pendingShelving: 0, pendingOutbound: 0, defective: 0, shipped: 0, warningQty: 0,
    price: product?.price ?? pool?.price ?? 0, declaredNameEn: product?.declaredNameEn ?? pool?.declaredNameEn ?? null,
    categoryPath: product?.categoryPath ?? pool?.categoryPath ?? null, stockSource: 'catalog',
  } })
  return true
}
