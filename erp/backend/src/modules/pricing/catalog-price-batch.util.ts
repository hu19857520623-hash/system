import { createHash } from 'node:crypto'
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PermissionsService } from '../../common/permissions/permissions.service'
import { catalogPrices, validateCatalogPrices, CATALOG_PRICE_TIERS } from './catalog-price.util'
import { setCatalogPrices } from './catalog-price-settings.util'

const LIMIT = 500, action = 'catalog_prices_batch'
const validRequest = (id: unknown) => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)
function assertRows(rows: any) {
  if (!Array.isArray(rows) || !rows.length || rows.length > LIMIT) throw new BadRequestException(`每批需提交1至${LIMIT}个商品`)
}
function assertRequest(id: unknown) { if (!validRequest(id)) throw new BadRequestException('请保留有效的原批次请求标识') }
function skuKeys(sku: string) {
  const base = /^TKL-/i.test(sku) ? sku.slice(4) : sku
  return [...new Set([sku, base, `TKL-${base}`].filter(s => s && s.length <= 30))]
}
function pricePatch(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length || Object.keys(value).some(t => !CATALOG_PRICE_TIERS.includes(t as any))) throw new BadRequestException('请填写至少一档价格，只支持A/B/C/D档')
  return value
}
function expectedPrices(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('') !== 'ABCD' || Object.values(value).some(v => v !== null && (typeof v !== 'number' || !Number.isFinite(v)))) throw new BadRequestException('缺少有效原价格，请重新预览')
  return value
}
async function withActor(prisma: any, actor: number, fn: (tx: any) => Promise<any>) {
  if (!Number.isSafeInteger(actor) || actor <= 0) throw new ForbiddenException('请使用有定价权限的原账号操作')
  return prisma.$transaction(async (tx: any) => {
    await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(actor)} FOR UPDATE`
    const user = await tx.sysUser.findUnique({ where: { id: BigInt(actor) } })
    if (!user || user.status !== 1 || !await new PermissionsService(tx).userHasPerm(actor, user.roleCode, 'pricing.set')) throw new ForbiddenException('当前账号无货盘定价权限，请重新登录核对')
    return fn(tx)
  }, { timeout: 30000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
}
const findReceipt = (tx: any, actor: number, id: string) => tx.operationLog.findFirst({ where: { module: 'pricing', action, operatorId: BigInt(actor), targetId: id } })
export async function listCatalogBatchItems(prisma: any, keyword?: string) {
  if (keyword != null && (typeof keyword !== 'string' || keyword.length > 100)) throw new BadRequestException('搜索内容最多100字')
  const q = keyword?.trim(), where = { pricingStatus: { in: ['priced','synced'] }, ...(q ? { OR: [{ sku: { contains: q } }, { productName: { contains: q } }] } : {}) }
  const [rows,total] = await Promise.all([prisma.productPricing.findMany({ where, orderBy: { id: 'asc' }, take: LIMIT }), prisma.productPricing.count({ where })])
  return { items: rows.map((r: any) => ({ id: Number(r.id), sku: r.sku, name: r.productName, prices: catalogPrices(r) })), total, limit: LIMIT }
}
export async function previewCatalogPriceBatch(prisma: any, body: any) {
  assertRows(body?.rows)
  const keys = body.rows.flatMap((r: any) => typeof r?.sku === 'string' && r.sku.trim().length <= 30 ? skuKeys(r.sku.trim()) : [])
  const products: any[] = await prisma.productPricing.findMany({ where: { sku: { in: [...new Set(keys)] } } })
  const items: any[] = [], errors: any[] = [], ids = new Map<number,number>()
  body.rows.forEach((raw: any, index: number) => {
    const line = index + 2, sku = typeof raw?.sku === 'string' ? raw.sku.trim() : ''
    try {
      if (!sku || sku.length > 30) throw new BadRequestException('SKU必填，最多30字')
      const patch = pricePatch(raw.prices), allowed = skuKeys(sku).map(s => s.toLowerCase())
      const matches = products.filter(r => allowed.includes(r.sku.toLowerCase()))
      if (matches.length !== 1) throw new BadRequestException(matches.length ? 'SKU匹配到多份货盘商品，请先核对编码' : 'SKU不在货盘商品中')
      const row = matches[0], id = Number(row.id)
      if (ids.has(id)) throw new BadRequestException(`与第${ids.get(id)}行重复匹配同一商品`)
      ids.set(id,line)
      if (!['priced','synced'].includes(row.pricingStatus)) throw new BadRequestException('商品尚未完成基础定价')
      const before = catalogPrices(row), prices = validateCatalogPrices({ ...before, ...patch })
      items.push({ line, id, sku: row.sku, name: row.productName, expectedPrices: before, prices })
    } catch (e: any) { errors.push({ line, sku, message: e?.message || '价格校验失败' }) }
  })
  return { items, errors, total: body.rows.length, canSubmit: !errors.length && items.length === body.rows.length }
}
export async function submitCatalogPriceBatch(prisma: any, body: any, actor: number) {
  assertRequest(body?.requestId);assertRows(body?.rows)
  const remark = typeof body.remark === 'string' ? body.remark.trim() : ''
  if (!remark || remark.length > 500) throw new BadRequestException('请填写批量调价原因，最多500字')
  const rows = body.rows.map((r: any) => {
    if (!Number.isSafeInteger(r?.id) || r.id <= 0) throw new BadRequestException('商品标识无效，请重新预览')
    return { id: r.id, expectedPrices: expectedPrices(r.expectedPrices), prices: validateCatalogPrices(r.prices) }
  }).sort((a: any,b: any) => a.id-b.id)
  if (new Set(rows.map((r: any) => r.id)).size !== rows.length) throw new BadRequestException('同一批次不能重复提交商品')
  const fingerprint = createHash('sha256').update(JSON.stringify({ rows: rows.map((r: any) => ({ id:r.id, expectedPrices:CATALOG_PRICE_TIERS.map(t=>r.expectedPrices[t]), prices:CATALOG_PRICE_TIERS.map(t=>r.prices[t]) })), remark })).digest('hex')
  return withActor(prisma, actor, async tx => {
    const previous = await findReceipt(tx,actor,body.requestId)
    if (previous) {
      if (previous.detail?.result?.status === 'cancelled') return previous.detail.result
      if (previous.detail?.fingerprint !== fingerprint) throw new ConflictException('原批次内容不同，请核对原批次结果，不能覆盖原请求')
      return { ...previous.detail.result, duplicate: true }
    }
    await tx.$queryRaw`SELECT id FROM product_pricing WHERE id IN (${Prisma.join(rows.map((r: any) => BigInt(r.id)))}) ORDER BY id FOR UPDATE`
    let changed = 0
    for (const row of rows) {
      const current = await tx.productPricing.findUnique({ where: { id: BigInt(row.id) } })
      if (!current || !['priced','synced'].includes(current.pricingStatus)) throw new ConflictException(`商品${row.id}已变化或未定价，整批未保存，请重新预览`)
      const before = catalogPrices(current)
      if (CATALOG_PRICE_TIERS.some(t => before[t] !== row.expectedPrices[t])) throw new ConflictException(`${current.sku}价格已变化，整批未保存，请重新预览`)
      if (CATALOG_PRICE_TIERS.some(t => before[t] !== row.prices[t])) {
        await setCatalogPrices({ $transaction: (fn: any) => fn(tx) }, row.id, { prices: row.prices, expectedPrices: before, remark }, actor)
        changed++
      }
    }
    const result = { requestId: body.requestId, status: 'applied', total: rows.length, changed, unchanged: rows.length-changed, duplicate: false }
    await tx.operationLog.create({ data: { module: 'pricing', action, operatorId: BigInt(actor), targetType: 'product_pricing_batch', targetId: body.requestId, detail: { fingerprint, remark, result, rows } } })
    return result
  })
}
export async function catalogPriceBatchReceipt(prisma: any, id: string, actor: number, cancel = false) {
  assertRequest(id)
  return withActor(prisma, actor, async tx => {
    const previous = await findReceipt(tx,actor,id)
    if (previous) return { ...previous.detail.result, duplicate: true }
    if (!cancel) return { requestId: id, status: 'unknown' }
    const result = { requestId: id, status: 'cancelled' }
    await tx.operationLog.create({ data: { module: 'pricing', action, operatorId: BigInt(actor), targetType: 'product_pricing_batch', targetId: id, detail: { result } } })
    return result
  })
}
