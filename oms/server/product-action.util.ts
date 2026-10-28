import { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { PRODUCT_ACTIONS, type ProductAction, type ProductActionItem } from '../src/data/productActionContract.js'
import { comparableProductMetadata } from '../src/data/productSaveContract.js'
import { validateImportedProduct } from '../src/data/productImportContract.js'
import { InventoryWriteError, inventoryProductsInput } from './inventory-write.util.js'
import { isCatalogPoolScope } from './customer-scope.util.js'

type Identity = { userId: string; role: string; customerId: string | null }
type ReceiptRow = { request_id: string; content_hash: string; action: ProductAction; product_ids: string; status: 'confirmed' | 'cancelled' }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function scope(identity: Identity) { return hash([identity.role === 'sys_admin' ? 'admin' : 'customer', identity.role === 'sys_admin' ? null : identity.customerId]) }
function requestId(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new InventoryWriteError('商品操作编号无效，请返回列表核对原操作')
  return value.toLowerCase()
}
function result(row: ReceiptRow) { return { requestId: row.request_id, status: row.status, action: row.action, productIds: JSON.parse(row.product_ids) as string[] } }
async function find(db: Pick<Prisma.TransactionClient, '$queryRaw'>, id: string, actor: Identity) {
  return (await db.$queryRaw<ReceiptRow[]>`SELECT request_id,content_hash,action,product_ids,status FROM oms_product_action WHERE request_id=${id} AND actor_id=${actor.userId} AND scope_key=${scope(actor)}`)[0]
}
export async function readProductAction(db: Pick<Prisma.TransactionClient, '$queryRaw'>, value: unknown, actor: Identity) {
  const id = requestId(value), row = await find(db, id, actor)
  return row ? result(row) : { requestId: id, status: 'unknown' as const }
}

/** State changes never accept browser product metadata. Account and row locks serialize live status checks. */
export async function applyProductAction(db: { $transaction: any }, value: unknown, body: any, actor: Identity,
  assertSku: (tx: Prisma.TransactionClient, data: any, id: string) => Promise<void>, cancel = false,
) {
  const id = requestId(value)
  if (!PRODUCT_ACTIONS.includes(body?.action)) throw new InventoryWriteError('商品操作无效，请从列表重新选择')
  const action = body.action as ProductAction
  const items = inventoryProductsInput(body.items) as ProductActionItem[]
  for (const item of items) {
    if (!item.customerId || typeof item.customerId !== 'string' || isCatalogPoolScope(item.customerId) || typeof item.expected !== 'string') throw new InventoryWriteError('商品原版本或客户信息缺失，请刷新列表后重新选择')
    if (actor.role !== 'sys_admin' && actor.customerId !== item.customerId) throw new InventoryWriteError('不能操作其他客户的商品', 403)
  }
  const fingerprint = hash([action, items])
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    for (const owner of [...new Set(items.map(row => row.customerId))].sort()) {
      const accounts = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM oms_customeraccount WHERE id=${owner} FOR UPDATE`
      if (!accounts.length) throw new InventoryWriteError('所选客户不存在，请返回列表核对', 404)
    }
    const existing = await find(tx, id, actor)
    if (existing) {
      if (existing.content_hash !== fingerprint) throw new InventoryWriteError('原商品操作内容不能更改，请先核对或取消原操作', 409)
      return result(existing)
    }
    if (!cancel) for (const item of [...items].sort((a,b) => a.id.localeCompare(b.id))) {
      await tx.$queryRaw`SELECT id FROM oms_product WHERE id=${item.id} FOR UPDATE`
      const product = await tx.product.findUnique({ where: { id: item.id } })
      if (!product) throw new InventoryWriteError('所选商品已删除或不存在，请返回列表核对', 409)
      if (product.customerId !== item.customerId || product.inCatalog) throw new InventoryWriteError('共享货盘或其他客户商品不能在此操作', 403)
      if (comparableProductMetadata(product) !== item.expected) throw new InventoryWriteError('商品资料或状态已变化，旧操作不能覆盖新资料；请取消原操作后刷新列表重新选择', 409)
      let next: string
      if (action === 'approve') {
        if (!['draft', 'reviewing'].includes(product.productStatus)) throw new InventoryWriteError('仅草稿或待审核商品可以审核，请刷新列表核对', 409)
        const invalid = validateImportedProduct(product)
        if (invalid) throw new InventoryWriteError(`${product.customerSku}：${invalid}，请先编辑商品资料`)
        await assertSku(tx, product, product.id)
        next = 'available'
      } else if (action === 'discard') {
        if (!['draft', 'reviewing', 'available'].includes(product.productStatus)) throw new InventoryWriteError('商品状态不支持废弃，请刷新列表核对', 409)
        await tx.$executeRaw`INSERT INTO oms_product_discard_origin(product_id,customer_id,from_status) VALUES(${product.id},${item.customerId},${product.productStatus}) ON DUPLICATE KEY UPDATE customer_id=VALUES(customer_id),from_status=VALUES(from_status)`
        next = 'discarded'
      } else {
        if (product.productStatus !== 'discarded') throw new InventoryWriteError('仅废弃商品可以恢复，请刷新列表核对', 409)
        const origins = await tx.$queryRaw<Array<{ from_status: string }>>`SELECT from_status FROM oms_product_discard_origin WHERE product_id=${product.id} AND customer_id=${item.customerId} FOR UPDATE`
        next = origins[0]?.from_status === 'available' && !validateImportedProduct(product) ? 'available' : 'draft'
        await assertSku(tx, product, product.id)
        await tx.$executeRaw`DELETE FROM oms_product_discard_origin WHERE product_id=${product.id} AND customer_id=${item.customerId}`
      }
      await tx.product.update({ where: { id: product.id }, data: { productStatus: next } })
    }
    const ids = cancel ? [] : items.map(row => row.id), status = cancel ? 'cancelled' : 'confirmed'
    await tx.$executeRaw`INSERT INTO oms_product_action(request_id,actor_id,scope_key,content_hash,action,product_ids,status) VALUES(${id},${actor.userId},${scope(actor)},${fingerprint},${action},${JSON.stringify(ids)},${status})`
    return { requestId: id, status: status as 'confirmed' | 'cancelled', action, productIds: ids }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 60000 })
}
