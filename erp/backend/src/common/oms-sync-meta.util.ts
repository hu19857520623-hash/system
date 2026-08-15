/** OMS ↔ ERP remark 元数据标签，保证 OMS 独有字段在 ERP 也有存储 */

const META_RE = /\[oms_meta:([^\]]+)\]/i
const PRE_DEDUCT_RE = /\[oms_pre_deduct:([^\]]+)\]/i
const MEASURE_RE = /\[oms_measure:([^\]]+)\]/i
const ACTUAL_FEES_RE = /\[oms_actual_fees:([^\]]+)\]/i
const STOCK_RE = /\[stock:(catalog|owned)\]/i
const OMS_CODE_RE = /\[OMS:([^\]]+)\]/
const OMS_CUSTOMER_LABEL_RE = /OMS客户:([^\s·]+)/

export type OmsOutboundMeta = {
  destination?: string
  shippingMethod?: string
  source?: string
  orderNo?: string
  destRegion?: string
}

export type OmsOutboundPreDeductLine = {
  type: string
  label: string
  amount: number
  detail?: string
}

/** OMS 价格模板快照（P6-2 实测算费） */
export type OmsOutboundFeeTemplateSnapshot = {
  handling: { perOrderBase: number; perUnit: number; perSkuLine: number }
  shipping: {
    mode: 'volume' | 'weight'
    ratePerCbm?: number
    ratePerKg?: number
    minCharge: number
  }
  pickup?: { perOrder: number; perUnit: number; minCharge: number }
  shippingMethod: string
  destRegion: string
}

/** OMS 提交出库时预扣摘要（P6-1） */
export type OmsOutboundPreDeduct = {
  destRegion?: string
  priceTemplateId?: string
  priceTemplateName?: string
  preDeductTotal: number
  totalVolumeM3?: number
  totalWeightKg?: number
  lines: OmsOutboundPreDeductLine[]
  deductedAt?: string
  templateSnapshot?: OmsOutboundFeeTemplateSnapshot
}

export type OmsOutboundMeasureCarton = {
  cartonNo: number
  lengthCm: number
  widthCm: number
  heightCm: number
  grossWeightKg: number
  volumeCbm: number
}

/** ERP 复核打包实测（P6-2） */
export type OmsOutboundMeasure = {
  cartons: OmsOutboundMeasureCarton[]
  totalVolumeM3: number
  totalWeightKg: number
  measuredAt: string
}

export type OmsOutboundActualFeeLine = {
  type: string
  label: string
  amount: number
  detail?: string
  chargeType?: string
}

/** ERP 按实测计算的出库费用（P6-2） */
export type OmsOutboundActualFees = {
  lines: OmsOutboundActualFeeLine[]
  actualTotal: number
  calculatedAt: string
}

export type OmsInboundMeta = {
  source?: string
  inboundType?: string
  deliveryMethod?: string
  stockSource?: string
  referenceNo?: string
  eta?: string
  contact?: string
  contactPhone?: string
}

export type OmsProductMeta = {
  declaredNameEn?: string
  declaredNameCn?: string
  unit?: string
  customerSku?: string
}

function parseMetaJson<T extends Record<string, string>>(raw: string | null | undefined): T {
  const m = String(raw || '').match(META_RE)
  if (!m) return {} as T
  try {
    const parsed = JSON.parse(m[1]) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (v != null && String(v).trim()) out[k] = String(v).trim()
    }
    return out as T
  } catch {
    return {} as T
  }
}

export function parseOmsOutboundMeta(remark: string | null | undefined): OmsOutboundMeta {
  return parseMetaJson<OmsOutboundMeta>(remark)
}

function parseTaggedJson<T>(remark: string | null | undefined, tagPrefix: string): T | null {
  const raw = String(remark || '')
  const re = new RegExp(`\\[${tagPrefix}:`, 'i')
  const start = raw.search(re)
  if (start < 0) return null
  const jsonStart = raw.indexOf('{', start)
  if (jsonStart < 0) return null
  let depth = 0
  for (let i = jsonStart; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(jsonStart, i + 1)) as T
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function removeTaggedBlock(remark: string | null | undefined, tagPrefix: string): string {
  const raw = String(remark || '')
  const re = new RegExp(`\\[${tagPrefix}:`, 'i')
  const start = raw.search(re)
  if (start < 0) return raw
  const jsonStart = raw.indexOf('{', start)
  if (jsonStart < 0) return raw
  let depth = 0
  for (let i = jsonStart; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const end = i + 1 < raw.length && raw[i + 1] === ']' ? i + 2 : i + 1
        return `${raw.slice(0, start)}${raw.slice(end)}`.replace(/\s+/g, ' ').trim()
      }
    }
  }
  return raw
}

export function parseOmsOutboundPreDeduct(remark: string | null | undefined): OmsOutboundPreDeduct | null {
  const parsed = parseTaggedJson<OmsOutboundPreDeduct>(remark, 'oms_pre_deduct')
  if (!parsed || typeof parsed.preDeductTotal !== 'number' || !Array.isArray(parsed.lines)) return null
  return {
    destRegion: parsed.destRegion?.trim() || undefined,
    priceTemplateId: parsed.priceTemplateId?.trim() || undefined,
    priceTemplateName: parsed.priceTemplateName?.trim() || undefined,
    preDeductTotal: parsed.preDeductTotal,
    totalVolumeM3: parsed.totalVolumeM3,
    totalWeightKg: parsed.totalWeightKg,
    lines: parsed.lines.map(l => ({
      type: String(l.type || ''),
      label: String(l.label || ''),
      amount: Number(l.amount) || 0,
      detail: l.detail ? String(l.detail) : undefined,
    })),
    deductedAt: parsed.deductedAt?.trim() || undefined,
    templateSnapshot: parsed.templateSnapshot as OmsOutboundFeeTemplateSnapshot | undefined,
  }
}

export function parseOmsOutboundMeasure(remark: string | null | undefined): OmsOutboundMeasure | null {
  const parsed = parseTaggedJson<OmsOutboundMeasure>(remark, 'oms_measure')
  if (!parsed || !Array.isArray(parsed.cartons)) return null
  return parsed
}

export function parseOmsOutboundActualFees(remark: string | null | undefined): OmsOutboundActualFees | null {
  const parsed = parseTaggedJson<OmsOutboundActualFees>(remark, 'oms_actual_fees')
  if (!parsed || !Array.isArray(parsed.lines)) return null
  return {
    lines: parsed.lines.map(l => ({
      type: String(l.type || ''),
      label: String(l.label || ''),
      amount: Number(l.amount) || 0,
      detail: l.detail ? String(l.detail) : undefined,
      chargeType: l.chargeType ? String(l.chargeType) : undefined,
    })),
    actualTotal: Number(parsed.actualTotal) || 0,
    calculatedAt: parsed.calculatedAt || '',
  }
}

function tagFromJson(prefix: string, payload: unknown): string {
  return `[${prefix}:${JSON.stringify(payload)}]`
}

export function upsertOutboundMeasureInRemark(remark: string | null | undefined, measure: OmsOutboundMeasure): string {
  const base = removeTaggedBlock(remark, 'oms_measure')
  return `${base} ${tagFromJson('oms_measure', measure)}`.trim()
}

export function upsertOutboundActualFeesInRemark(
  remark: string | null | undefined,
  fees: OmsOutboundActualFees,
): string {
  const base = removeTaggedBlock(remark, 'oms_actual_fees')
  return `${base} ${tagFromJson('oms_actual_fees', fees)}`.trim()
}

function preDeductTag(preDeduct?: OmsOutboundPreDeduct | null): string {
  if (!preDeduct || !Array.isArray(preDeduct.lines) || preDeduct.lines.length === 0) return ''
  const payload: OmsOutboundPreDeduct = {
    destRegion: preDeduct.destRegion,
    priceTemplateId: preDeduct.priceTemplateId,
    priceTemplateName: preDeduct.priceTemplateName,
    preDeductTotal: Math.round(preDeduct.preDeductTotal * 100) / 100,
    totalVolumeM3: preDeduct.totalVolumeM3,
    totalWeightKg: preDeduct.totalWeightKg,
    lines: preDeduct.lines.map(l => ({
      type: l.type,
      label: l.label,
      amount: Math.round(l.amount * 100) / 100,
      detail: l.detail,
    })),
    templateSnapshot: preDeduct.templateSnapshot,
    deductedAt: preDeduct.deductedAt || new Date().toISOString().slice(0, 19).replace('T', ' '),
  }
  return `[oms_pre_deduct:${JSON.stringify(payload)}]`
}

export function parseOmsInboundMeta(remark: string | null | undefined): OmsInboundMeta {
  return parseMetaJson<OmsInboundMeta>(remark)
}

export function parseOmsProductMeta(remark: string | null | undefined): OmsProductMeta {
  return parseMetaJson<OmsProductMeta>(remark)
}

export function parseStockSourceFromRemark(remark: string | null | undefined): 'catalog' | 'owned' | null {
  const m = String(remark || '').match(STOCK_RE)
  return m ? (m[1] as 'catalog' | 'owned') : null
}

export function parseOmsCustomerCodeFromRemark(remark: string | null | undefined): string | null {
  const raw = String(remark || '')
  const bracket = raw.match(OMS_CODE_RE)
  if (bracket) return bracket[1].trim()
  const label = raw.match(OMS_CUSTOMER_LABEL_RE)
  return label ? label[1].trim() : null
}

/** 去掉系统标签，保留用户备注 */
export function stripOmsSystemTags(remark: string | null | undefined): string {
  let out = String(remark || '')
  out = removeTaggedBlock(out, 'oms_meta')
  out = removeTaggedBlock(out, 'oms_pre_deduct')
  out = removeTaggedBlock(out, 'oms_measure')
  out = removeTaggedBlock(out, 'oms_actual_fees')
  return out
    .replace(STOCK_RE, '')
    .replace(OMS_CODE_RE, '')
    .replace(OMS_CUSTOMER_LABEL_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function metaTag(meta: Record<string, string | undefined>): string {
  const clean = Object.fromEntries(
    Object.entries(meta).filter(([, v]) => v != null && String(v).trim()),
  )
  if (!Object.keys(clean).length) return ''
  return `[oms_meta:${JSON.stringify(clean)}]`
}

export function buildOutboundRemark(opts: {
  customerCode: string
  stockSource?: 'catalog' | 'owned'
  userRemark?: string
  meta?: OmsOutboundMeta
  preDeduct?: OmsOutboundPreDeduct | null
}): string {
  const parts = [
    `[OMS:${opts.customerCode}]`,
    `[stock:${opts.stockSource === 'owned' ? 'owned' : 'catalog'}]`,
    metaTag(opts.meta || {}),
    preDeductTag(opts.preDeduct),
    opts.userRemark?.trim() || '',
  ].filter(Boolean)
  return parts.join(' ')
}

export function buildInboundRemark(opts: {
  customerCode: string
  userRemark?: string
  meta?: OmsInboundMeta
}): string {
  const parts = [`[OMS:${opts.customerCode}]`, metaTag(opts.meta || {}), opts.userRemark?.trim() || ''].filter(Boolean)
  return parts.join(' ')
}

export function buildProductRemark(opts: {
  customerCode?: string
  userRemark?: string
  meta?: OmsProductMeta
}): string {
  const parts = [
    opts.customerCode ? `OMS客户:${opts.customerCode}` : '',
    metaTag(opts.meta || {}),
    opts.userRemark?.trim() || '',
  ].filter(Boolean)
  return parts.join(' · ') || ''
}
