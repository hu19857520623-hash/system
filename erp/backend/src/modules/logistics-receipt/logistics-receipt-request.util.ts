import { BadRequestException } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import type { CreateLogisticsReceiptDto } from './logistics-receipt.dto'

export function logisticsReceiptRequest(data: CreateLogisticsReceiptDto, warehouseCode: string) {
  if (!data.clientRequestId && !data.receiptNo?.trim()) throw new BadRequestException('请提供收货操作标识，重新打开单据后重试')
  if (!Number.isSafeInteger(data.poId) || data.poId <= 0) throw new BadRequestException('请填写有效的采购单编号')
  if (!Array.isArray(data.items) || !data.items.length) throw new BadRequestException('请填写收货明细')
  const ids = new Set<number>()
  const items = data.items.map(line => {
    if (!Number.isSafeInteger(line.poItemId) || line.poItemId <= 0 || ids.has(line.poItemId)) throw new BadRequestException('采购明细编号无效或重复，请刷新核对')
    ids.add(line.poItemId)
    if (typeof line.actualQty !== 'number' || (line.damagedQty != null && typeof line.damagedQty !== 'number')) throw new BadRequestException('良品实收及破损数量须填写有效整数')
    const actualQty = Number(line.actualQty), damagedQty = Number(line.damagedQty ?? 0)
    if (![actualQty, damagedQty].every(qty => Number.isSafeInteger(qty) && qty >= 0 && qty <= 2147483647)) throw new BadRequestException('良品实收及破损数量须为 0 至 2147483647 的整数')
    if (actualQty + damagedQty <= 0) throw new BadRequestException('每项收货明细须填写良品实收或破损数量')
    if (line.qcStatus && !['pass', 'fail'].includes(line.qcStatus)) throw new BadRequestException('质检结论须为通过或异常')
    return { poItemId: line.poItemId, sku: String(line.sku || '').trim(), actualQty, damagedQty,
      qcStatus: damagedQty > 0 ? 'fail' : line.qcStatus || 'pass', qcRemark: String(line.qcRemark || '').trim() }
  }).sort((a, b) => a.poItemId - b.poItemId)
  return { poId: data.poId, warehouseCode, remark: String(data.remark || '').trim(), items }
}

export type LogisticsReceiptRequest = ReturnType<typeof logisticsReceiptRequest>

export function logisticsReceiptNumber(data: Pick<CreateLogisticsReceiptDto, 'receiptNo' | 'clientRequestId'>) {
  if (data.clientRequestId) return `LR-${createHash('sha256').update(data.clientRequestId).digest('hex').slice(0, 27)}`
  return data.receiptNo?.trim() || `LR-${randomUUID().replace(/-/g, '').slice(0, 27)}`
}

export function receiptStoredRemark(request: LogisticsReceiptRequest, clientRequestId?: string) {
  return JSON.stringify({ kind: 'logistics-receipt-v1', request, clientRequestId: clientRequestId || null })
}

export function receiptRequestMetadata(remark: string | null | undefined): { request: LogisticsReceiptRequest; clientRequestId: string | null } | null {
  try {
    const parsed = JSON.parse(remark || '')
    return parsed?.kind === 'logistics-receipt-v1' && typeof parsed.request?.remark === 'string' && Array.isArray(parsed.request?.items) ? parsed : null
  } catch { return null }
}
