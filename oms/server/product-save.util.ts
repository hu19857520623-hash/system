import { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { comparableProductMetadata } from '../src/data/productSaveContract.js'
import { validateImportedProduct } from '../src/data/productImportContract.js'
import { InventoryWriteError, inventoryProductsInput, saveInventoryProductsInTransaction } from './inventory-write.util.js'
import { isCatalogPoolScope } from './customer-scope.util.js'

type Row = { request_id: string; content_hash: string; product_id: string | null; status: 'confirmed' | 'cancelled' }
function idFor(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new InventoryWriteError('保存请求编号无效，请返回商品列表核对')
  return value.toLowerCase()
}
function receipt(row: Row) { return { requestId: row.request_id, status: row.status, productId: row.product_id } }
async function find(db: Pick<Prisma.TransactionClient, '$queryRaw'>, requestId: string, actor: string, customer: string) {
  return (await db.$queryRaw<Row[]>`SELECT request_id,content_hash,product_id,status FROM oms_product_save WHERE request_id=${requestId} AND actor_id=${actor} AND customer_id=${customer}`)[0]
}
export async function readProductSave(db: Pick<Prisma.TransactionClient, '$queryRaw'>, id: unknown, actor: string, customer: string) {
  const requestId = idFor(id), row = await find(db, requestId, actor, customer)
  return row ? receipt(row) : { requestId, status: 'unknown' as const }
}
export async function saveProductWithReceipt(db: { $transaction: any }, id: unknown, body: any, actor: string, customer: string,
  dataFor: (row: any, owner: string) => Record<string, any>, assertSku: (tx: Prisma.TransactionClient, data: any, id: string) => Promise<void>,
) {
  const requestId = idFor(id), row = inventoryProductsInput([body?.product])[0]
  if (!actor || !customer || isCatalogPoolScope(customer) || row.customerId !== customer) throw new InventoryWriteError('请使用原客户账号保存商品', 403)
  if (!['create', 'update'].includes(body.mode) || (body.mode === 'create' ? body.expected !== null : typeof body.expected !== 'string')) throw new InventoryWriteError('商品原版本缺失，请返回列表重新打开商品')
  const hash = createHash('sha256').update(JSON.stringify([customer, body.mode, body.expected, row])).digest('hex')
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const accounts = await tx.$queryRaw<Array<{ id: string; code: string }>>`SELECT id,code FROM oms_customeraccount WHERE id=${customer} FOR UPDATE`
    if (!accounts[0]?.code) throw new InventoryWriteError('客户编码不存在，请返回列表核对', 404)
    const previousReceipt = await find(tx, requestId, actor, customer)
    if (previousReceipt) {
      if (previousReceipt.status !== 'cancelled' && previousReceipt.content_hash !== hash) throw new InventoryWriteError('原保存内容不能更改，请先核对或取消原保存请求', 409)
      return receipt(previousReceipt)
    }
    await tx.$queryRaw`SELECT id FROM oms_product WHERE id=${row.id} FOR UPDATE`
    const previous = await tx.product.findUnique({ where: { id: row.id } })
    if (body.mode === 'create' && previous) throw new InventoryWriteError('商品记录已存在，创建操作不能覆盖现有商品，请返回列表核对', 409)
    if (body.mode === 'update') {
      if (!previous) throw new InventoryWriteError('商品已删除或不存在，请返回列表核对', 409)
      if (previous.customerId !== customer || previous.inCatalog) throw new InventoryWriteError('此商品不能在当前客户商品表单中修改，请返回列表核对', 403)
      if (previous.productStatus === 'discarded' || comparableProductMetadata(previous) !== body.expected) throw new InventoryWriteError('商品资料已变化，旧保存不能覆盖新资料；请取消原保存请求后从列表重新打开', 409)
      if (previous.productStatus !== 'draft' && row.productStatus !== previous.productStatus) throw new InventoryWriteError('商品状态已变化，请返回列表核对后继续', 409)
    }
    if (!row.name?.trim() || !row.customerSku?.trim() || row.customerSku.trim().length >= 12) throw new InventoryWriteError('请填写商品名称与少于12位的客户SKU')
    if (!previous || previous.productStatus === 'draft') {
      if (!['draft', 'available'].includes(row.productStatus)) throw new InventoryWriteError('请选择保存草稿或提交商品')
    }
    if (row.productStatus === 'available') {
      const invalid = validateImportedProduct(row)
      if (invalid) throw new InventoryWriteError(invalid)
    }
    const part = String(row.customerSku).trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)
    const prefix = `${accounts[0].code.trim().toUpperCase()}-${part}`
    if (!part || !(row.internalSku === previous?.internalSku && row.customerSku === previous?.customerSku || new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:-[2-9][0-9]*|-[1-9][0-9]+)?$`, 'i').test(row.internalSku))) throw new InventoryWriteError('系统SKU与客户编码不符，请返回列表核对')
    await saveInventoryProductsInTransaction(tx, [row], customer, dataFor, () => undefined, assertSku, body.mode === 'create')
    await tx.$executeRaw`INSERT INTO oms_product_save(request_id,actor_id,customer_id,content_hash,product_id,status) VALUES(${requestId},${actor},${customer},${hash},${row.id},'confirmed')`
    return { requestId, status: 'confirmed' as const, productId: row.id }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 60000 })
}
export async function cancelProductSave(db: { $transaction: any }, id: unknown, actor: string, customer: string) {
  const requestId = idFor(id)
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const accounts = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM oms_customeraccount WHERE id=${customer} FOR UPDATE`
    if (!accounts.length) throw new InventoryWriteError('客户不存在，请返回商品列表核对', 404)
    const previous = await find(tx, requestId, actor, customer)
    if (previous) return receipt(previous)
    await tx.$executeRaw`INSERT INTO oms_product_save(request_id,actor_id,customer_id,content_hash,product_id,status) VALUES(${requestId},${actor},${customer},'',NULL,'cancelled')`
    return { requestId, status: 'cancelled' as const, productId: null }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 60000 })
}
