/** 易仓同款单号。与 erp/shared/wms-doc-no.ts 保持一致。 */

export const WMS_FALLBACK_CUSTOMER = 'TKL'

export type WmsScanKind = 'inbound_no' | 'outbound_no' | 'carton'

export interface WmsScanHit {
  kind: WmsScanKind
  value: string
  inboundNo?: string
  outboundNo?: string
  boxSeq?: number
}

export function sanitizeWmsCustomerCode(value?: string | null): string {
  const raw = String(value || '').trim().toUpperCase()
  if (!raw || raw === '—' || raw === '-') return ''
  return raw.replace(/[^A-Z0-9]/g, '').slice(0, 16)
}

export function resolveWmsCustomerCode(value?: string | null): string {
  return sanitizeWmsCustomerCode(value) || WMS_FALLBACK_CUSTOMER
}

export function wmsDocYymmdd(date = new Date()): string {
  const y = String(date.getFullYear() % 100).padStart(2, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function padSeq(seq: number): string {
  const n = Math.max(1, Math.floor(Number(seq) || 1))
  return String(n).padStart(4, '0')
}

export function inboundNoPrefix(customerCode?: string | null, date = new Date()): string {
  return `RV${resolveWmsCustomerCode(customerCode)}-${wmsDocYymmdd(date)}-`
}

export function outboundNoPrefix(customerCode?: string | null, date = new Date()): string {
  return `DO${resolveWmsCustomerCode(customerCode)}-${wmsDocYymmdd(date)}-`
}

export function nextSeqFromNos(existingNos: string[], prefix: string): number {
  const needle = prefix.toUpperCase()
  let max = 0
  for (const raw of existingNos) {
    const no = String(raw || '').trim().toUpperCase()
    if (!no.startsWith(needle)) continue
    const seq = Number.parseInt(no.slice(needle.length), 10)
    if (Number.isFinite(seq)) max = Math.max(max, seq)
  }
  return max + 1
}

export function buildInboundNo(customerCode?: string | null, date = new Date(), seq = 1): string {
  return `${inboundNoPrefix(customerCode, date)}${padSeq(seq)}`
}

export function buildOutboundNo(customerCode?: string | null, date = new Date(), seq = 1): string {
  return `${outboundNoPrefix(customerCode, date)}${padSeq(seq)}`
}

export function buildCartonCode(inboundNo: string, boxSeq: number): string {
  const inbound = String(inboundNo || '').trim()
  const seq = Math.max(1, Math.floor(Number(boxSeq) || 1))
  if (!inbound) return String(seq)
  const parsed = parseWmsScan(inbound)
  if (parsed?.kind === 'carton' && parsed.boxSeq === seq) return parsed.value
  if (parsed?.kind === 'carton') {
    return `${parsed.inboundNo}-${seq}`
  }
  return `${inbound}-${seq}`
}

const RV_CARTON = /^(RV[A-Z0-9]+-\d{6}-\d{4})-(\d+)$/i
const RV_INBOUND = /^(RV[A-Z0-9]+-\d{6}-\d{4})$/i
const DO_OUTBOUND = /^(DO[A-Z0-9]+-\d{6}-\d{4})$/i
const IPI_INBOUND = /^(IPI[A-Z0-9]+\d{6}\d{4})$/i
const LEGACY_CARTON = /^(IN[-_][A-Z0-9-]+)-C(\d{3,})$/i
const LEGACY_INBOUND = /^(IN[-_].+)$/i
const LEGACY_OUTBOUND = /^(OUT[-_].+|OB[-_].+)$/i

export function parseWmsScan(raw: string): WmsScanHit | null {
  const value = String(raw || '').trim().toUpperCase()
  if (!value) return null

  const rvCarton = RV_CARTON.exec(value)
  if (rvCarton) {
    return { kind: 'carton', value, inboundNo: rvCarton[1].toUpperCase(), boxSeq: Number(rvCarton[2]) }
  }
  const rvIn = RV_INBOUND.exec(value)
  if (rvIn) return { kind: 'inbound_no', value, inboundNo: rvIn[1].toUpperCase() }

  const ipi = IPI_INBOUND.exec(value)
  if (ipi) return { kind: 'inbound_no', value, inboundNo: ipi[1].toUpperCase() }

  const dout = DO_OUTBOUND.exec(value)
  if (dout) return { kind: 'outbound_no', value, outboundNo: dout[1].toUpperCase() }

  const legacyCarton = LEGACY_CARTON.exec(value)
  if (legacyCarton) {
    return {
      kind: 'carton',
      value,
      inboundNo: legacyCarton[1].toUpperCase(),
      boxSeq: Number(legacyCarton[2]),
    }
  }
  if (LEGACY_INBOUND.test(value)) return { kind: 'inbound_no', value, inboundNo: value }
  if (LEGACY_OUTBOUND.test(value)) return { kind: 'outbound_no', value, outboundNo: value }
  return null
}

export function inboundNoFromScan(raw: string): string {
  const parsed = parseWmsScan(raw)
  if (parsed?.kind === 'carton') return parsed.inboundNo || ''
  if (parsed?.kind === 'inbound_no') return parsed.inboundNo || parsed.value
  return String(raw || '').trim()
}

export function isOutboundDocNo(raw: string): boolean {
  return parseWmsScan(raw)?.kind === 'outbound_no'
}

export function matchCartonByScan<T extends { boxCode: string; boxSeq: number }>(
  cartons: T[],
  scan: string,
  inboundNo: string,
): T | null {
  const token = String(scan || '').trim().toUpperCase()
  if (!token || !cartons.length) return null
  const exact = cartons.find((c) => String(c.boxCode || '').trim().toUpperCase() === token)
  if (exact) return exact

  const parsed = parseWmsScan(token)
  const orderNo = String(inboundNo || '').trim().toUpperCase()
  if (parsed?.kind === 'carton' && parsed.inboundNo === orderNo) {
    return cartons.find((c) => c.boxSeq === parsed.boxSeq) || null
  }

  const cSuffix = token.match(/-C(\d{3,})$/)
  if (cSuffix) {
    const seq = Number(cSuffix[1])
    return cartons.find((c) => c.boxSeq === seq || String(c.boxCode || '').toUpperCase().endsWith(cSuffix[0])) || null
  }
  return null
}
