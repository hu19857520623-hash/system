import { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { InventoryWriteError, inventoryProductsInput, saveInventoryProductsInTransaction } from './inventory-write.util.js'
import { validateImportedProduct } from '../src/data/productImportContract.js'
import { isCatalogPoolScope } from './customer-scope.util.js'

type ReceiptRow = { request_id: string; actor_id: string; customer_id: string; content_hash: string; product_ids: string; row_count: number; status: 'confirmed' | 'cancelled' }
export function productImportId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new InventoryWriteError('导入批次编号无效，请返回商品列表核对原批次')
  return value.toLowerCase()
}
function receipt(row: ReceiptRow) {
  return { requestId: row.request_id, status: row.status, count: row.row_count, productIds: JSON.parse(row.product_ids) as string[] }
}
async function findReceipt(db: Pick<Prisma.TransactionClient, '$queryRaw'>, requestId: string, actorId: string, customerId: string) {
  return (await db.$queryRaw<ReceiptRow[]>`SELECT request_id, actor_id, customer_id, content_hash, product_ids, row_count, status
    FROM oms_product_import WHERE request_id = ${requestId} AND actor_id = ${actorId} AND customer_id = ${customerId}`)[0]
}
export async function readProductImport(db: Pick<Prisma.TransactionClient, '$queryRaw'>, id: unknown, actorId: string, customerId: string) {
  const requestId = productImportId(id), row = await findReceipt(db, requestId, actorId, customerId)
  return row ? receipt(row) : { requestId, status: 'unknown' as const }
}

/** The receipt and new cards commit together; a replay never rewrites later edits or revives deletions. */
export async function importProductBatch(db: { $transaction: any }, id: unknown, value: unknown, actorId: string, customerId: string,
  dataFor: (row: Record<string, any>, owner: string) => Record<string, any>,
  assertSku: (tx: Prisma.TransactionClient, data: any, id: string) => Promise<void>,
) {
  const requestId = productImportId(id), rows = inventoryProductsInput(value)
  if (!actorId || !customerId || isCatalogPoolScope(customerId)) throw new InventoryWriteError('请使用已绑定客户的原账号导入商品', 403)
  const hash = createHash('sha256').update(JSON.stringify([customerId, rows])).digest('hex')
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const accounts = await tx.$queryRaw<Array<{ id: string; code: string }>>`SELECT id, code FROM oms_customeraccount WHERE id = ${customerId} FOR UPDATE`
    if (!accounts[0]?.code) throw new InventoryWriteError('客户编码无法核对，请返回商品列表刷新')
    const previous = await findReceipt(tx, requestId, actorId, customerId)
    if (previous) {
      if (previous.status === 'cancelled') return receipt(previous)
      if (previous.content_hash !== hash) throw new InventoryWriteError('原导入批次内容不能更改，请先核对原批次', 409)
      return receipt(previous)
    }
    const keys = new Set<string>()
    for (const row of rows) {
      if (row.customerId !== customerId) throw new InventoryWriteError('不能导入其他客户的商品', 403)
      const invalid = validateImportedProduct(row)
      if (invalid) throw new InventoryWriteError(invalid)
      const part = String(row.customerSku).trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)
      const prefix = `${accounts[0].code.trim().toUpperCase()}-${part}`
      if (!part || !new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:-[2-9][0-9]*|-[1-9][0-9]+)?$`, 'i').test(String(row.internalSku))) throw new InventoryWriteError('系统SKU与客户编码不符，请重新核对导入文件')
      const key = String(row.customerSku).trim().toLowerCase()
      if (keys.has(key)) throw new InventoryWriteError(`导入文件存在重复SKU：${row.customerSku}`)
      keys.add(key)
    }
    await saveInventoryProductsInTransaction(tx, rows, customerId, (row, owner) => ({ ...dataFor(row, owner),
      productStatus: 'draft', productSource: 'import', price: row.declaredValue, cost: 0,
    }), validateImportedProduct, assertSku, true)
    const ids = rows.map(row => row.id)
    await tx.$executeRaw`INSERT INTO oms_product_import (request_id, actor_id, customer_id, content_hash, product_ids, row_count, status)
      VALUES (${requestId}, ${actorId}, ${customerId}, ${hash}, ${JSON.stringify(ids)}, ${ids.length}, 'confirmed')`
    return { requestId, status: 'confirmed' as const, count: ids.length, productIds: ids }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 60000 })
}

/** A cancellation fences a late original POST. Confirmed imports are never deleted. */
export async function cancelProductImport(db: { $transaction: any }, id: unknown, actorId: string, customerId: string) {
  const requestId = productImportId(id)
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const accounts = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM oms_customeraccount WHERE id = ${customerId} FOR UPDATE`
    if (!accounts.length) throw new InventoryWriteError('客户不存在，请返回列表核对', 404)
    const existing = await findReceipt(tx, requestId, actorId, customerId)
    if (existing) return receipt(existing)
    await tx.$executeRaw`INSERT INTO oms_product_import (request_id, actor_id, customer_id, content_hash, product_ids, row_count, status)
      VALUES (${requestId}, ${actorId}, ${customerId}, '', '[]', 0, 'cancelled')`
    return { requestId, status: 'cancelled' as const, count: 0, productIds: [] as string[] }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 60000 })
}
