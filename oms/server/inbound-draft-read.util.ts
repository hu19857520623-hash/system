import type { Prisma } from '@prisma/client'
import { InboundIdentityError } from './inbound-order-persistence.util.js'
import { readInboundPlan } from './inbound-plan.util.js'
import { inboundSavedVersion } from './inbound-save.util.js'

/** A cancelled ERP ASN describes the last submitted shipment, not the customer's
 * newly saved draft. Read that plan from its owner-scoped OMS row. Bad records
 * are reported separately so polling never replaces them with old ERP quantities. */
export async function readSavedInboundDrafts(db: Pick<Prisma.TransactionClient, 'customerAccount' | 'inboundOrder'>, code: string, scope: string | null, cancelledNos: string[]) {
  if (scope === '') throw new InboundIdentityError(403, '客户身份无效，请重新登录后读取草稿')
  const customerCode = code.trim()
  if (!customerCode) throw new InboundIdentityError(400, '缺少客户编码，无法读取草稿')
  if (!cancelledNos.length) return { drafts: [], draftReadErrors: [] }
  const account = await db.customerAccount.findFirst({ where: { code: customerCode, ...(scope ? { id: scope } : {}) }, select: { id: true } })
  if (!account) {
    if (scope) throw new InboundIdentityError(403, '当前客户编码与登录客户不一致，请重新打开入库记录')
    return { drafts: [], draftReadErrors: [] }
  }
  const rows = await db.inboundOrder.findMany({ where: { customerId: account.id, status: 'draft', inboundNo: { in: cancelledNos } }, orderBy: { id: 'asc' } })
  const drafts: Record<string, unknown>[] = [], draftReadErrors: { inboundNo: string; message: string }[] = []
  for (const row of rows) {
    try {
      const { lineItems, attachments } = readInboundPlan(row)
      drafts.push({ ...row, lineItems, attachments, omsRevision: inboundSavedVersion(row) })
    } catch {
      draftReadErrors.push({ inboundNo: row.inboundNo, message: `已保存草稿 ${row.inboundNo} 的货品或附件资料无法读取，请保留记录并核对` })
    }
  }
  return { drafts, draftReadErrors }
}
