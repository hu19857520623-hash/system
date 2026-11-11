import { BadRequestException, ConflictException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { parseOmsInboundMeta, stripOmsSystemTags } from '../../common/oms-sync-meta.util'
import { normalizeOmsAsnCustomerDimensions } from './oms-asn-dimensions.util'

type Header = Partial<Record<'trackingNo' | 'referenceNo' | 'source' | 'inboundType' | 'deliveryMethod' | 'stockSource' | 'eta' | 'contact' | 'contactPhone' | 'remark', string | null>>
type Line = { sku: string; qty: number; boxNo?: number; productName?: string; lengthCm?: unknown; widthCm?: unknown; heightCm?: unknown }
type Request = Header & { customerCode: string; items: Line[] }
const fields = ['source', 'inboundType', 'deliveryMethod', 'stockSource', 'referenceNo', 'eta', 'contact', 'contactPhone'] as const
const text = (value: unknown) => String(value ?? '').trim()

function header(data: Header) {
  return { trackingNo: text(data.trackingNo || data.referenceNo), remark: text(data.remark), ...Object.fromEntries(fields.map(key => [key, text(data[key])])) }
}

/** Immutable creation identity, independent of later product measurement or other orders. */
export function omsAsnRequestIdentity(data: Request, warehouseCode: string, canonicalSkus: string[]) {
  const lines = new Map<string, number>()
  for (const [index, line] of data.items.entries()) {
    let dimensions
    try { dimensions = normalizeOmsAsnCustomerDimensions(line) }
    catch { throw new BadRequestException('客户尺寸无效，请同时填写大于零的长、宽、高') }
    const key = JSON.stringify([Number(line.boxNo) || index + 1, canonicalSkus[index], text(line.productName), dimensions])
    lines.set(key, (lines.get(key) || 0) + Number(line.qty))
  }
  return createHash('sha256').update(JSON.stringify({ customerCode: text(data.customerCode), warehouseCode, header: header(data), lines: [...lines].sort(([a], [b]) => a.localeCompare(b)) })).digest('hex')
}

export function assertLegacyOmsAsnMetadata(data: Request, stored: Header) {
  const meta = parseOmsInboundMeta(stored.remark)
  const saved = { ...stored, remark: stripOmsSystemTags(stored.remark), ...Object.fromEntries(fields.map(key => [key, stored[key] ?? meta[key]])) }
  if (JSON.stringify(header(data)) !== JSON.stringify(header(saved))) {
    throw new ConflictException('入库联系人、运单号或预报信息与原单不一致，请查看原单后通过修改入口继续')
  }
  if (data.items.some(line => [line.lengthCm, line.widthCm, line.heightCm].some(value => value != null && value !== ''))) {
    throw new ConflictException('历史入库单没有保存原尺寸回执，无法确认本次为原请求，请打开原单核对后通过修改入口继续')
  }
}
