import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { getPagination } from '../../common/dto/pagination.dto'
import { catalogSkuLookupKeys } from '../../common/catalog-customer.util'
import { readCatalogRefunds } from '../billing/catalog-refund-ledger.util'
import { assertRefundAuthority } from './catalog-reclaim.util'
import type { CatalogReclaimHistoryQueryDto } from './dto/catalog-reclaim.dto'

async function verifiedRow(db: any, row: any, actor: number, customers: Map<number, any[]>) {
  const customerId = row.detail?.customerId
  if (!Number.isSafeInteger(customerId) || customerId <= 0) throw new BadRequestException('退款回执缺少客户依据，请联系财务核对')
  if (!customers.has(customerId)) {
    const customer = await db.customer.findUnique({ where: { id: BigInt(customerId) } })
    if (!customer) throw new BadRequestException('退款回执对应客户缺失，请联系财务核对')
    customers.set(customerId, [customer, await readCatalogRefunds(db, customer)])
  }
  const [customer, refunds] = customers.get(customerId)!
  const saved = row.detail.response, refund = refunds.find((r: any) => r.referenceNo === saved?.referenceNo)
  if (!refund || typeof saved?.sku !== 'string' || !saved.sku.trim()) throw new BadRequestException('退款回执依据不完整，请联系财务核对')
  return { id: Number(row.id), referenceNo: refund.referenceNo, customerCode: customer.customerCode, customerName: customer.customerName || '', sku: saved.sku,
    quantity: saved.quantity, amount: refund.amount, balanceBefore: Number(row.detail.refund.balanceBefore), balanceAfter: Number(row.detail.refund.balanceAfter),
    createdAt: row.createdAt, operatorId: Number(row.operatorId), canRetrySync: Number(row.operatorId) === actor,
    remark: typeof row.detail.request?.remark === 'string' ? row.detail.request.remark : '',
    allocations: refund.allocations.map((a: any) => ({ orderId: a.orderId, orderNo: a.orderNo, quantity: a.quantity, unitPrice: a.unitCents / 100, amount: a.amountCents / 100 })),
  }
}

export async function catalogReclaimHistory(prisma: any, query: CatalogReclaimHistoryQueryDto, actor?: number) {
  const { page, pageSize } = getPagination(query)
  return prisma.$transaction(async (db: any) => {
    await assertRefundAuthority(db, actor)
    const AND: any[] = [{ detail: { path: '$.refundVersion', equals: 1 } }]
    if (query.customerCode?.trim()) AND.push({ detail: { path: '$.response.customerCode', equals: query.customerCode.trim() } })
    if (query.sku?.trim()) AND.push({ OR: catalogSkuLookupKeys(query.sku.trim()).map(sku => ({ detail: { path: '$.response.sku', equals: sku } })) })
    const where = { module: 'inventory', action: 'catalog_reclaim', AND }
    const [rows, total] = await Promise.all([
      db.operationLog.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { id: 'desc' } }), db.operationLog.count({ where }),
    ])
    const users = rows.length ? await db.sysUser.findMany({ where: { id: { in: [...new Set(rows.map((r: any) => r.operatorId))] } }, select: { id: true, realName: true } }) : []
    const names = new Map(users.map((u: any) => [Number(u.id), u.realName]))
    const customers = new Map<number, any[]>(), items: any[] = []
    for (const row of rows) {
      const verified = await verifiedRow(db, row, actor!, customers)
      items.push({ ...verified, operatorName: names.get(verified.operatorId) || `历史账号（${verified.operatorId}）` })
    }
    return { items, total, page, pageSize, source: 'erp_refund_receipt' }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 })
}

/** This path only reads an existing committed refund. It cannot create a new credit. */
export async function catalogReclaimSyncReceipt(prisma: any, id: number, actor?: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new BadRequestException('请选择有效的原退款记录')
  return prisma.$transaction(async (db: any) => {
    await assertRefundAuthority(db, actor)
    const row = await db.operationLog.findFirst({ where: { id: BigInt(id), module: 'inventory', action: 'catalog_reclaim', detail: { path: '$.refundVersion', equals: 1 } } })
    if (!row) throw new NotFoundException('原退款回执不存在，请返回退款记录重新查询')
    if (Number(row.operatorId) !== actor) throw new ForbiddenException('请使用原收回账号核对同步，本次未新增退款')
    const verified = await verifiedRow(db, row, actor!, new Map())
    return { ...row.detail.response, customerCode: verified.customerCode, sku: verified.sku, quantity: verified.quantity, refundAmount: verified.amount, duplicate: true }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 })
}
