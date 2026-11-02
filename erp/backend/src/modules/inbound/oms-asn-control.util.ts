import { BadRequestException, ConflictException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'

export type OmsAsnControl = { clientRequestId?: string; expectedVersion?: string }
export const OMS_ASN_ACTIONS = ['oms_asn_update', 'oms_asn_reactivate', 'oms_asn_cancel']
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' && !(value instanceof Date)
    ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value), (_, x) => typeof x === 'bigint' ? String(x) : x)).digest('hex')

/** Include stable item IDs so cancel/reactivate cannot restore an old form's version. */
export function omsAsnVersion(order: { id: bigint | number; inboundNo: string; status: string; updatedAt: Date; remark: string | null; warehouseCode: string; trackingNo: string | null; items?: { id?: bigint | number; sku: string; expectedQty: number }[] }) {
  return hash({ id: order.id, inboundNo: order.inboundNo, status: order.status, updatedAt: order.updatedAt, remark: order.remark, warehouseCode: order.warehouseCode, trackingNo: order.trackingNo,
    items: (order.items || []).map(row => [String(row.id ?? ''), row.sku, row.expectedQty]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) })
}

export function omsAsnControl<T extends OmsAsnControl>(no: string, kind: string, data: T) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(data.clientRequestId || '')) throw new BadRequestException('缺少有效的入库操作标识，请重新打开原单后操作')
  if (!/^[a-f0-9]{64}$/.test(data.expectedVersion || '')) throw new BadRequestException('缺少原单版本，请刷新并重新打开原单后操作')
  return { clientRequestId: data.clientRequestId!, expectedVersion: data.expectedVersion!, requestFingerprint: hash({ no, kind, data }) }
}

export async function previousOmsAsnControl(tx: Prisma.TransactionClient, customerCode: string, no: string, request: ReturnType<typeof omsAsnControl>) {
  const previous = await tx.operationLog.findFirst({ where: { module: 'inbound', action: { in: OMS_ASN_ACTIONS }, AND: [
    { detail: { path: '$.customerCode', equals: customerCode } }, { detail: { path: '$.clientRequestId', equals: request.clientRequestId } },
  ] } })
  if (!previous) return false
  const detail = previous.detail as { requestFingerprint?: string }
  if (previous.targetId !== no || detail?.requestFingerprint !== request.requestFingerprint) throw new ConflictException('原入库操作对应的单据或内容不同，请先核对原操作，不要修改后重试')
  return true
}

export function assertOmsAsnVersion(order: Parameters<typeof omsAsnVersion>[0], expectedVersion: string) {
  if (omsAsnVersion(order) !== expectedVersion) throw new ConflictException('入库单已被其他操作更新，请刷新并重新打开原单后操作')
}
