import type { Prisma } from '@prisma/client'
import { InboundIdentityError } from './inbound-order-persistence.util.js'

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
      const lineItems = row.lineItems ? JSON.parse(row.lineItems) : []
      const attachments = row.attachments ? JSON.parse(row.attachments) : []
      if (!Array.isArray(lineItems) || !Array.isArray(attachments) || row.receivedQty !== 0) throw new Error()
      const boxes = new Set<number>(), skus = new Set<string>()
      let qty = 0
      for (const [index, line] of lineItems.entries()) {
        if (!line || typeof line.sku !== 'string' || !line.sku.trim() || !Number.isSafeInteger(line.qty) || line.qty <= 0) throw new Error()
        const boxNo = line.boxNo ?? index + 1
        if (!Number.isSafeInteger(boxNo) || boxNo <= 0) throw new Error()
        boxes.add(boxNo); skus.add(line.sku); qty += line.qty
      }
      if (!Number.isSafeInteger(qty) || row.totalQty !== qty || row.skuCount !== skus.size || (lineItems.length ? row.boxCount !== boxes.size : ![0, 1].includes(row.boxCount))) throw new Error()
      drafts.push({ ...row, lineItems, attachments })
    } catch {
      draftReadErrors.push({ inboundNo: row.inboundNo, message: `已保存草稿 ${row.inboundNo} 的货品或附件资料无法读取，请保留记录并核对` })
    }
  }
  return { drafts, draftReadErrors }
}
