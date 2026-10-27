import { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { isCatalogPoolScope } from './customer-scope.util.js'
import type { ErpInventoryViewItem } from './erpClient.js'

export class InventoryWriteError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

export function inventoryProductsInput(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 500) throw new InventoryWriteError('每次请选择1至500个商品保存')
  const ids = new Set<string>()
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || !row.id.trim() || row.id.length > 50 || ids.has(row.id)) throw new InventoryWriteError('商品记录无效或重复，请刷新商品列表后重新选择')
    ids.add(row.id)
  }
  return value as Record<string, any>[]
}

/** Browser product metadata never supplies stock counters, catalog membership or catalog commercial data. */
export function productWriteFields(data: Record<string, any>, previous?: Record<string, any> | null) {
  const { availableQty: _available, lockedQty: _locked, inCatalog: _catalog, ...editable } = data
  if (previous?.inCatalog) { delete editable.price; delete editable.cost }
  return previous ? editable : { ...editable, availableQty: 0, lockedQty: 0, inCatalog: false }
}

export async function saveInventoryProducts(
  db: { $transaction: any }, rows: Record<string, any>[], scope: string | null,
  dataFor: (row: Record<string, any>, owner: string) => Record<string, any>,
  validate: (row: Record<string, any>) => string | undefined,
  assertSku: (tx: Prisma.TransactionClient, data: any, id: string) => Promise<void>,
) {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const owners = [...new Set(rows.map(row => scope || String(row.customerId || '').trim()))].sort()
    for (const owner of owners) {
      if (!owner || isCatalogPoolScope(owner)) throw new InventoryWriteError('请选择客户商品；共享货盘请在ERP维护', 403)
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM oms_customeraccount WHERE id = ${owner} FOR UPDATE`
      if (!locked.length) throw new InventoryWriteError('所选客户不存在，请刷新后重新选择')
    }
    const deleted = await tx.$queryRaw<Array<{ entity_id: string }>>(Prisma.sql`
      SELECT entity_id FROM oms_snapshot_tombstone
      WHERE entity_type = 'product' AND entity_id IN (${Prisma.join(rows.map(row => row.id))})
    `)
    if (deleted.length) throw new InventoryWriteError('所选商品已删除，请刷新商品列表后重新选择', 409)
    const saved = []
    for (const row of rows) {
      const owner = scope || String(row.customerId || '').trim()
      if (scope && row.customerId && row.customerId !== scope) throw new InventoryWriteError('不能修改其他客户的商品', 403)
      const previous = await tx.product.findUnique({ where: { id: row.id } })
      if (previous && previous.customerId !== owner) throw new InventoryWriteError('不能修改其他客户或共享货盘的商品', 403)
      const invalid = validate(row)
      if (invalid) throw new InventoryWriteError(invalid)
      const data: Record<string, any> = { ...dataFor(row, owner), inCatalog: previous?.inCatalog ?? false }
      if (previous && previous.productStatus !== 'draft' && previous.productStatus !== 'discarded' && (previous.internalSku !== data.internalSku || previous.customerSku !== data.customerSku)) throw new InventoryWriteError('已提交商品的SKU不能更改，请刷新商品后核对')
      if (row.productStatus !== 'discarded' && (!previous || previous.internalSku !== data.internalSku || previous.customerSku !== data.customerSku || previous.productStatus === 'discarded')) await assertSku(tx, data, row.id)
      saved.push(await tx.product.upsert({ where: { id: row.id }, create: { id: row.id, ...productWriteFields(data) } as any, update: productWriteFields(data, previous) }))
    }
    return saved
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 60000 })
}

/** Serialize permanent deletion with metadata saves and canonical inventory refreshes. */
export async function deleteInventoryProduct(db: { product: any; $transaction: any }, id: string, scope: string | null) {
  const identity = await db.product.findUnique({ where: { id }, select: { customerId: true } })
  if (!identity) throw new InventoryWriteError('商品已删除或不存在，请刷新商品列表核对', 404)
  if (scope && identity.customerId !== scope) throw new InventoryWriteError('不能删除其他客户的商品', 403)
  const owner = identity.customerId
  if (!owner || isCatalogPoolScope(owner)) throw new InventoryWriteError('共享货盘请在ERP维护，不能在此删除', 403)
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM oms_customeraccount WHERE id = ${owner} FOR UPDATE`
    if (!locked.length) throw new InventoryWriteError('所选客户不存在，请刷新后核对', 404)
    const product = await tx.product.findUnique({ where: { id } })
    if (!product) throw new InventoryWriteError('商品已删除或不存在，请刷新商品列表核对', 404)
    if (product.customerId !== owner) throw new InventoryWriteError('商品归属已变化，请刷新后核对', 409)
    if (product.inCatalog) throw new InventoryWriteError('货盘商品请在ERP维护，不能在此删除', 403)
    if (product.productStatus !== 'discarded') throw new InventoryWriteError('仅废弃商品可永久删除')
    const stockFields = ['available', 'locked', 'inTransit', 'pendingShelving', 'pendingOutbound', 'defective'] as const
    const stock = await tx.inventoryItem.findFirst({ where: { sku: product.internalSku, customerId: owner,
      OR: stockFields.map(field => ({ [field]: { gt: 0 } })),
    }, select: { id: true } })
    if (product.availableQty > 0 || product.lockedQty > 0 || stock) throw new InventoryWriteError('该 SKU 仍有库存，不能永久删除；请先同步ERP核对库存')
    const inbounds = await tx.inboundOrder.findMany({ where: { customerId: owner }, select: { inboundNo: true, skuHint: true, lineItems: true } })
    for (const inbound of inbounds) {
      let lines: Array<{ sku?: unknown }> = []
      try {
        const value = JSON.parse(inbound.lineItems || '[]')
        if (!Array.isArray(value)) throw new Error('invalid lines')
        lines = value
      } catch { throw new InventoryWriteError('历史入库明细无法核对，请联系管理员处理后再删除', 409) }
      if (String(inbound.skuHint || '').split(/[\s,，、]+/).includes(product.internalSku)
        || lines.some(line => line && String(line.sku || '').trim() === product.internalSku)) throw new InventoryWriteError(`该 SKU 已关联入库单 ${inbound.inboundNo}，不能永久删除`)
    }
    await tx.$executeRaw`INSERT INTO oms_snapshot_tombstone (entity_type, entity_id) VALUES ('product', ${id}) ON DUPLICATE KEY UPDATE entity_id = entity_id`
    await tx.product.delete({ where: { id } })
    // A zero mirror may still belong to another historical card of the same SKU.
    const sibling = await tx.product.findFirst({ where: { customerId: owner, internalSku: product.internalSku }, select: { id: true } })
    if (!sibling) await tx.inventoryItem.deleteMany({ where: { customerId: owner, sku: product.internalSku, stockSource: 'owned',
      AND: stockFields.map(field => ({ [field]: { lte: 0 } })),
    } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 60000 })
}

function quantity(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 2147483647) throw new InventoryWriteError('ERP返回的库存数量无效，请稍后重试同步', 502)
  return value
}

/** Only a server-fetched ERP result reaches this function; never accept a browser inventory snapshot. */
export async function applyErpInventoryView(tx: Prisma.TransactionClient, customerId: string, warehouse: string, items: ErpInventoryViewItem[]) {
  const existing = await tx.inventoryItem.findMany({ where: { customerId, warehouse: { in: [warehouse, warehouseAlias(warehouse)] } }, orderBy: { id: 'asc' } })
  const products = await tx.product.findMany({ where: { customerId } })
  const keys = new Set<string>(), retained = new Set<string>()
  for (const item of items) {
    if (!item.sku || !['owned', 'catalog'].includes(item.stockSource) || keys.has(`${item.stockSource}:${item.sku}`)) throw new InventoryWriteError('ERP库存范围返回异常，请重新同步核对', 502)
    const key = `${item.stockSource}:${item.sku}`; keys.add(key)
    const row = existing.find(row => row.sku === item.sku && row.stockSource === item.stockSource)
    const product = products.find(p => p.internalSku === item.sku)
    const data = {
      available: quantity(item.warehouseAvailable), locked: quantity(item.stockSource === 'catalog' ? item.quantity : item.warehouseLocked),
      ...(item.stockSource === 'owned' ? { inTransit: quantity(item.inTransitQty ?? 0), pendingShelving: quantity(item.pendingShelvingQty ?? 0) } : {}),
      name: item.productName || product?.name || row?.name || item.sku,
      warehouse: warehouseAlias(warehouse),
      ...(item.unitPrice != null && Number.isFinite(item.unitPrice) && item.unitPrice >= 0 ? { price: item.unitPrice } : {}),
    }
    if (row) { retained.add(row.id); await tx.inventoryItem.update({ where: { id: row.id }, data }) }
    else {
      const id = `erp-${item.stockSource[0]}-${createHash('sha256').update(JSON.stringify([customerId, warehouse, item.stockSource, item.sku])).digest('hex').slice(0, 40)}`
      const collision = await tx.inventoryItem.findUnique({ where: { id } })
      if (collision && (collision.customerId !== customerId || collision.sku !== item.sku || collision.stockSource !== item.stockSource)) throw new InventoryWriteError('库存镜像标识冲突，请联系管理员核对', 409)
      await tx.inventoryItem.upsert({ where: { id }, update: data, create: {
        id, customerId, sku: item.sku, image: product?.image || '', spec: product?.spec || '',
        inTransit: 0, pendingShelving: 0, pendingOutbound: 0, defective: 0, shipped: 0,
        safetyStock: 0, warningQty: 0, price: 0, stockSource: item.stockSource, ...data,
      } })
      retained.add(id)
    }
    if (item.stockSource === 'owned') await tx.product.updateMany({ where: { customerId, internalSku: item.sku, inCatalog: false }, data: { availableQty: data.available, lockedQty: data.locked } })
  }
  // Missing/duplicate old display rows cannot keep stale usable stock after a complete ERP response.
  for (const row of existing) if (!retained.has(row.id)) {
    await tx.inventoryItem.update({ where: { id: row.id }, data: { available: 0, locked: 0, inTransit: 0, pendingShelving: 0 } })
    if (row.stockSource === 'owned' && !keys.has(`owned:${row.sku}`)) await tx.product.updateMany({ where: { customerId, internalSku: row.sku, inCatalog: false }, data: { availableQty: 0, lockedQty: 0 } })
  }
  return { inventory: await tx.inventoryItem.findMany({ where: { customerId } }), products: await tx.product.findMany({ where: { customerId } }) }
}

function warehouseAlias(value: string) {
  const code = value.toLowerCase()
  if (['jhb1', 'jhb3', 'cpt1', 'cpt2', 'dbn'].includes(code)) return code
  const match = code.match(/(?:^|-)(jhb|cpt|dbn)-(\d+)$/)
  return match ? match[1] === 'dbn' ? 'dbn' : `${match[1]}${Number(match[2])}` : value
}
