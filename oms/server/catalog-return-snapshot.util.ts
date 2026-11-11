import type { PrismaClient } from '@prisma/client'
import { applyCatalogReclaimSnapshot } from './catalog-reclaim-snapshot.util.js'

type Holding = { sku: string; quantity: number; productName?: string; unitPrice?: number | null }

/** A return event is a refresh signal: its quantity may predate a reclaim or purchase. */
export async function applyCatalogReturnSnapshot(prisma: PrismaClient, customerId: string,
  line: { sku: string; holdingQty?: number }, load: () => Promise<Holding[]>) {
  const sku = String(line.sku || '').trim(), quantity = Number(line.holdingQty)
  if (!sku || !Number.isSafeInteger(quantity) || quantity < 0) return false
  await applyCatalogReclaimSnapshot(prisma, customerId, sku, load)
  return true
}
