/** Takealot 发货四类 PDF（外箱标/清单/预约单/SKU标签）文本解析 */

export type TakealotDocKind = '外箱标' | 'SKU 标签' | '发货清单' | '预约单' | string

export interface TakealotLineItem {
  sku: string
  qty: number
  productTitle?: string
  barcode?: string
  tsin?: string
  /** Shipping note / manifest demand. Never infer this from repeated unit labels. */
  expectedQty?: number
  /** Number of readable unit-label cells observed in the product-label PDF. */
  observedLabelCount?: number
}

export interface TakealotParsedDoc {
  poNumber?: string
  sellerId?: string
  sellerName?: string
  /** 清单 Due Date */
  shipmentDate?: string
  /** Takealot 文件名中的生成/发货日期，不等同于 Due Date。 */
  sourceDate?: string
  /** 预约单 Date of Booking */
  appointmentDate?: string
  /** 归一化目的仓：jhb3 / cpt2 / dbn / jhb1 … */
  warehouseCode?: string
  warehouseConfidence?: 'generic' | 'explicit'
  shipmentName?: string
  bookingRef?: string
  asnNumber?: string
  totalUnits?: number
  lineItems: TakealotLineItem[]
  sources: string[]
}

export function detectTakealotDocKind(fileName: string, text = ''): TakealotDocKind {
  const name = fileName.toLowerCase()
  const body = text.toLowerCase()
  if (/^tal[a-z0-9]+\.pdf$/i.test(fileName) || /booking confirmation|booking reference number|date of booking/i.test(text)) {
    return '预约单'
  }
  if (/product.?labels?|sku.?labels?|条码|sku标签/.test(name)) {
    return 'SKU 标签'
  }
  if (
    /shipping.?labels?|carton|outer.?box|box.?label|外箱|箱标/.test(name)
    || /marketplace shipment|please leave this label uncovered|box\s+_+\s+of\s+_+/i.test(text)
  ) {
    return '外箱标'
  }
  if (/barcode|tsin/i.test(text) && !/shipment name|included pos|shipping note/i.test(text)) {
    return 'SKU 标签'
  }
  if (
    /shipping.?note|manifest|shipment|packing.?list|发货清单|装箱单/.test(name)
    || /shipping note|shipment content|included pos|due date/i.test(text)
  ) {
    return '发货清单'
  }
  if (/_PO_/i.test(fileName) || /takealot|seller id|po number/.test(body)) return '发货清单'
  return '发货清单'
}

export function takealotMissingFields(doc: TakealotParsedDoc): string[] {
  const missing: string[] = []
  if (!doc.poNumber) missing.push('PO 单号')
  if (!doc.warehouseCode) missing.push('目的仓')
  if (!doc.appointmentDate) missing.push('预约时间')
  if (!doc.sellerId) missing.push('Seller ID')
  if (!doc.sellerName) missing.push('店铺名称')
  if (!doc.bookingRef) missing.push('Booking Reference')
  if (!doc.lineItems.some(item => item.sku && item.qty > 0)) missing.push('SKU 明细')
  return missing
}

const TAKEALOT_IDENTITY_FIELDS: Array<[keyof TakealotParsedDoc, string]> = [
  ['poNumber', 'PO 单号'],
  ['sellerId', 'Seller ID'],
  ['appointmentDate', '预约时间'],
  ['bookingRef', 'Booking Reference'],
  ['asnNumber', 'ASN'],
]

function conflictingFieldValues(
  parts: Partial<TakealotParsedDoc>[],
  fields: Array<[keyof TakealotParsedDoc, string]>,
): string[] {
  const conflicts: string[] = []
  for (const [key, label] of fields) {
    const values = new Set(parts.map(part => part[key]).filter(Boolean).map(String))
    if (values.size > 1) conflicts.push(`${label}不一致：${[...values].join(' / ')}`)
  }
  return conflicts
}

function warehouseConflicts(parts: Partial<TakealotParsedDoc>[]): string[] {
  const warehouseParts = parts.filter(part => part.warehouseCode)
  const explicitWarehouses = new Set(
    warehouseParts
      .filter(part => part.warehouseConfidence === 'explicit')
      .map(part => part.warehouseCode),
  )
  const warehouseRegions = new Set(
    warehouseParts.map(part => part.warehouseCode?.replace(/\d+$/, '')).filter(Boolean),
  )
  if (explicitWarehouses.size > 1 || warehouseRegions.size > 1) {
    return [`目的仓不一致：${[...new Set(warehouseParts.map(part => part.warehouseCode))].join(' / ')}`]
  }
  return []
}

/** Upload-time identity check. Filename `_PO_{sellerId}_` is not a PO number. */
export function takealotIdentityConflicts(parts: Partial<TakealotParsedDoc>[]): string[] {
  return [
    ...conflictingFieldValues(parts, TAKEALOT_IDENTITY_FIELDS),
    ...warehouseConflicts(parts),
  ]
}

export function takealotParseConflicts(parts: Partial<TakealotParsedDoc>[]): string[] {
  const conflicts = [
    ...takealotIdentityConflicts(parts),
    ...conflictingFieldValues(parts, [
      ['sellerName', '店铺名称'],
      ['shipmentName', 'Shipment Name'],
      ['totalUnits', '总件数'],
    ]),
  ]

  const qtyBySku = new Map<string, Set<number>>()
  for (const part of parts) {
    for (const item of part.lineItems || []) {
      const key = item.barcode || item.sku
      const expectedQty = item.expectedQty
      if (!key || !expectedQty) continue
      const values = qtyBySku.get(key) || new Set<number>()
      values.add(expectedQty)
      qtyBySku.set(key, values)
    }
  }
  for (const [sku, values] of qtyBySku) {
    if (values.size > 1) conflicts.push(`${sku} 数量存在冲突：${[...values].join(' / ')}`)
  }
  return conflicts
}

export function takealotParseWarnings(doc: TakealotParsedDoc): string[] {
  const warnings: string[] = []
  const bookingDay = doc.appointmentDate?.slice(0, 10)
  if (bookingDay && doc.shipmentDate && bookingDay > doc.shipmentDate) {
    warnings.push(`预约日期 ${bookingDay} 晚于 Due Date ${doc.shipmentDate}`)
  }
  return warnings
}

const WH_ALIAS: Record<string, string> = {
  JHB3: 'jhb3',
  JHB1: 'jhb1',
  JHB: 'jhb3',
  CPT2: 'cpt2',
  CPT1: 'cpt1',
  CPT: 'cpt1',
  DBN1: 'dbn',
  DBN: 'dbn',
}

export function normalizeTakealotWarehouse(raw?: string | null): string | undefined {
  if (!raw) return undefined
  const s = String(raw).trim()
  if (/johannesburg\s*dc\s*3/i.test(s)) return 'jhb3'
  if (/johannesburg\s*dc\s*1/i.test(s)) return 'jhb1'
  if (/johannesburg/i.test(s)) return 'jhb3'
  if (/cape\s*town\s*dc\s*1/i.test(s)) return 'cpt1'
  if (/cape\s*town\s*dc\s*2/i.test(s)) return 'cpt2'
  if (/cape\s*town/i.test(s)) return 'cpt2'
  if (/durban/i.test(s)) return 'dbn'
  const key = s.toUpperCase().replace(/\s+/g, '')
  if (WH_ALIAS[key]) return WH_ALIAS[key]
  const m = key.match(/^(JHB3|JHB1|CPT2|CPT1|DBN1|DBN)$/)
  return m ? WH_ALIAS[m[1]] : undefined
}

/** ERP 目的仓编码（JHB3 / CPT2 …） */
export function toErpTakealotDestWh(code?: string): string | undefined {
  if (!code) return undefined
  const c = code.toLowerCase()
  if (c === 'jhb3') return 'JHB3'
  if (c === 'jhb1') return 'JHB1'
  if (c === 'cpt2') return 'CPT2'
  if (c === 'cpt1') return 'CPT1'
  if (c === 'dbn') return 'DBN1'
  return code.toUpperCase()
}

/** ERP fbaWarehouse → OMS 履约仓 id */
export function fromErpTakealotDestWh(erpCode?: string | null): string | undefined {
  if (!erpCode) return undefined
  const key = erpCode.toUpperCase().replace(/\s+/g, '')
  return WH_ALIAS[key] || erpCode.toLowerCase()
}

function parseEnDate(input: string): string {
  const s = input.trim()
  const m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})$/)
  if (m) {
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    const mi = monthNames.indexOf(m[1].slice(0, 3).toLowerCase())
    if (mi >= 0) return isoFromParts(m[3], String(mi + 1), m[2])
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return isoFromParts(String(d.getFullYear()), String(d.getMonth() + 1), String(d.getDate()))
}

function isoFromParts(y: string, m: string, d: string) {
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

export function parseTakealotFilename(fileName: string): Partial<TakealotParsedDoc> {
  const sources = [`filename:${fileName}`]
  const out: Partial<TakealotParsedDoc> = { sources, lineItems: [] }

  const m = fileName.match(
    /_PO_(\d+)_(\d{2})_(\d{2})_(\d{4})_(JHB3|JHB1|JHB|CPT2|CPT1|CPT|DBN1|DBN)_(\d+)/i,
  )
  if (m) {
    out.sellerId = m[1]
    out.sourceDate = isoFromParts(m[4], m[3], m[2])
    out.warehouseCode = normalizeTakealotWarehouse(m[5])
    out.warehouseConfidence = /\d$/.test(m[5]) ? 'explicit' : 'generic'
    out.shipmentName = `PO-${m[1]}-${m[2]}/${m[3]}/${m[4]}-${m[5].toUpperCase()}-${m[6]}`
  }

  const booking = fileName.match(/^(TAL[A-Z0-9]+)\.pdf$/i)
  if (booking) out.bookingRef = booking[1].toUpperCase()

  return out
}

export function parseTakealotDocumentText(text: string, kind?: TakealotDocKind): Partial<TakealotParsedDoc> {
  const sources = [`text:${kind || 'unknown'}`]
  const t = text.replace(/\r/g, '\n')
  const out: Partial<TakealotParsedDoc> = { sources, lineItems: [] }

  const po =
    t.match(/PO Number:\s*(\d{6,15})/i)
    || t.match(/Included POs[^\d]{0,40}(\d{6,15})/i)
    || t.match(/TAL\s*MP\s+(\d{6,15})\s+ASN[A-Z0-9]+/i)
  if (po) out.poNumber = po[1]

  const shipmentName = t.match(/Shipment Name:\s*(PO-[^\n]+)/i)
  if (shipmentName) {
    out.shipmentName = shipmentName[1].trim()
    const wh = shipmentName[1].match(/-(JHB3|JHB1|JHB|CPT2|CPT1|CPT|DBN1|DBN)-\d+/i)
    if (wh) {
      out.warehouseCode = normalizeTakealotWarehouse(wh[1])
      out.warehouseConfidence = /\d$/.test(wh[1]) ? 'explicit' : 'generic'
    }
  }

  const due = t.match(/Due Date:\s*(\d{4})[/-](\d{2})[/-](\d{2})/i)
  if (due) out.shipmentDate = isoFromParts(due[1], due[2], due[3])

  const bookingDate = t.match(/Date of Booking:\s*([A-Za-z]{3}\s+\d{1,2},\s+\d{4})/i)
  const timeSlot = t.match(/Time Slot:\s*(\d{1,2}:\d{2})/i)
  if (bookingDate) {
    const day = parseEnDate(bookingDate[1])
    out.appointmentDate = timeSlot ? `${day}T${timeSlot[1]}` : day
  }

  const sellerId = t.match(/Seller ID:\s*(\d+)/i)
  if (sellerId) out.sellerId = sellerId[1]

  const createdBy = t.match(/Created by\s+(.+?)\s+for Takealot/i)
  if (createdBy) out.sellerName = createdBy[1].trim()

  if (!out.sellerName) {
    const headerSeller =
      t.match(/Booking Confirmation[^\n]*\n\s*([A-Za-z][A-Za-z .'-]{2,80})\s*$/im)
      || t.match(/Booking Confirmation\s+([A-Za-z][A-Za-z .'-]{2,80})\s*(?:\n|$)/im)
      || t.match(/Booking Confirmation\s+([A-Za-z][A-Za-z .'-]{2,80}?)(?=Delivery Address:)/i)
    if (headerSeller) out.sellerName = headerSeller[1].replace(/\s+/g, ' ').trim()
  }

  const dc = t.match(/(Johannesburg DC(?:\s*\d)?|Cape Town DC(?:\s*\d)?|Durban DC(?:\s*\d)?)/i)
  if (dc) {
    out.warehouseCode = normalizeTakealotWarehouse(dc[0])
    out.warehouseConfidence = /\d\s*$/i.test(dc[0]) ? 'explicit' : 'generic'
  }

  if (!out.warehouseCode && /Johannesburg/i.test(t) && kind === '预约单') {
    out.warehouseCode = 'jhb3'
    out.warehouseConfidence = 'generic'
  }

  const bookingRef = t.match(/Booking Reference Number:\s*(TAL[A-Z0-9]+)/i)
  if (bookingRef) out.bookingRef = bookingRef[1].toUpperCase()

  const asn = t.match(/\b(ASN[A-Z0-9]{6,})\b/i)
  if (asn) out.asnNumber = asn[1].toUpperCase()

  const totalUnits =
    t.match(/Total units to collect:\s*(\d+)/i)
    || t.match(/Total units on delivery:\s*(\d+)/i)
    || t.match(/\bTAL\s*MP\s+\d{6,15}\s+ASN[A-Z0-9]+\s+(\d+)\s+Stock\b/i)
  if (totalUnits) out.totalUnits = Number(totalUnits[1])

  const addLine = (item: TakealotLineItem) => {
    if (!item.sku || !item.qty || item.qty <= 0) return
    const key = item.barcode || item.sku
    const existing = out.lineItems!.find(line => (line.barcode || line.sku) === key)
    if (existing) {
      existing.productTitle ||= item.productTitle
      existing.barcode ||= item.barcode
      existing.tsin ||= item.tsin
      existing.expectedQty ??= item.expectedQty
      existing.observedLabelCount =
        (existing.observedLabelCount || 0) + (item.observedLabelCount || 0) || undefined
      existing.qty = existing.expectedQty ?? existing.observedLabelCount ?? existing.qty
    } else {
      out.lineItems!.push(item)
    }
  }

  // 发货清单：优先按 PDF 行解析，支持多 SKU。
  const rows = t.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const labeled = row.match(
      /(?:SKU|Seller SKU)\s*[:#]?\s*([A-Z0-9][A-Z0-9_-]{1,29}).*?(?:Qty|Quantity|Units)\s*[:#]?\s*(\d{1,5})/i,
    )
    if (labeled) {
      const qty = Number(labeled[2])
      addLine({ sku: labeled[1].toUpperCase(), qty, expectedQty: qty })
      continue
    }

    const tabular = row.match(
      /^(\d{13})\s+(\d{8,11})\s+([A-Z0-9][A-Z0-9_-]{1,29})\s+(\d{1,5})(?:\s+Page\s+\d+.*)?$/i,
    )
    if (tabular) {
      const qty = Number(tabular[4])
      const titleRows: string[] = []
      for (let back = index - 1; back >= 0 && titleRows.length < 5; back -= 1) {
        const candidate = rows[back]
        if (
          /^\d{13}\s+\d{8,11}\s+/.test(candidate)
          || /^(MP Takealot Barcode|Product Title|TSIN|SKU|Units|SHIPMENT CONTENT)/i.test(candidate)
        ) break
        if (!/^\d+$/.test(candidate)) titleRows.unshift(candidate)
      }
      addLine({
        barcode: tabular[1],
        tsin: tabular[2],
        sku: tabular[3].toUpperCase(),
        qty,
        expectedQty: qty,
        productTitle: titleRows.join(' ') || undefined,
      })
      continue
    }

    const compact = row.match(/(?:(\d{13})\s*)?(\d{8,11})\s*([A-Z0-9][A-Z0-9_-]{1,29})(\d{1,5})\s*(?:Page\s*\d+)?$/i)
    if (compact) {
      const previous = rows[index - 1]
      const qty = Number(compact[4])
      addLine({
        barcode: compact[1],
        tsin: compact[2],
        sku: compact[3].toUpperCase(),
        qty,
        expectedQty: qty,
        productTitle:
          previous && !/^\d+$/.test(previous) && previous.length <= 160
            ? previous
            : undefined,
      })
    }
  }

  // 文本提取器可能把整页压成一行，使用全局紧凑格式兜底。
  if (!out.lineItems!.length) {
    const compactGlobal = /(\d{8,11})([A-Z0-9][A-Z0-9_-]{1,29})(\d{1,5})(?=\s*(?:Page|$))/gi
    for (const match of t.matchAll(compactGlobal)) {
      const qty = Number(match[3])
      addLine({ tsin: match[1], sku: match[2].toUpperCase(), qty, expectedQty: qty })
    }
  }

  return out
}

export function mergeTakealotParsed(...parts: Partial<TakealotParsedDoc>[]): TakealotParsedDoc {
  const result: TakealotParsedDoc = { sources: [], lineItems: [] }
  for (const p of parts) {
    if (p.poNumber) result.poNumber = p.poNumber
    if (p.sellerId) result.sellerId = p.sellerId
    if (p.sellerName) result.sellerName = p.sellerName
    if (p.shipmentDate) result.shipmentDate = p.shipmentDate
    if (p.sourceDate) result.sourceDate = p.sourceDate
    if (p.appointmentDate) result.appointmentDate = p.appointmentDate
    if (
      p.warehouseCode
      && (
        !result.warehouseCode
        || p.warehouseConfidence === 'explicit'
        || result.warehouseConfidence !== 'explicit'
      )
    ) {
      result.warehouseCode = p.warehouseCode
      result.warehouseConfidence = p.warehouseConfidence
    }
    if (p.shipmentName) result.shipmentName = p.shipmentName
    if (p.bookingRef) result.bookingRef = p.bookingRef
    if (p.asnNumber) result.asnNumber = p.asnNumber
    if (p.totalUnits) result.totalUnits = p.totalUnits
    if (p.lineItems?.length) {
      for (const item of p.lineItems) {
        if (!item.sku && !item.barcode) continue
        const key = item.barcode || item.sku
        const existing = result.lineItems.find(x => (x.barcode || x.sku) === key)
        if (existing) {
          existing.productTitle = existing.productTitle || item.productTitle
          existing.barcode = existing.barcode || item.barcode
          existing.tsin = existing.tsin || item.tsin
          if (item.sku) existing.sku = item.sku
          existing.expectedQty ??= item.expectedQty
          existing.observedLabelCount =
            (existing.observedLabelCount || 0) + (item.observedLabelCount || 0) || undefined
          existing.qty = existing.expectedQty ?? existing.observedLabelCount ?? existing.qty
        } else {
          const expectedQty = item.expectedQty
          const observedLabelCount = item.observedLabelCount
          result.lineItems.push({
            ...item,
            qty: expectedQty ?? observedLabelCount ?? item.qty,
          })
        }
      }
    }
    result.sources.push(...(p.sources || []))
  }
  return result
}

function formatAppointmentLabel(value: string): string {
  const m = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  if (m) return `${m[1]} ${m[2]}`
  const spaced = value.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/)
  if (spaced) return `${spaced[1]} ${spaced[2]}`
  return value
}

export function describeTakealotParsed(doc: TakealotParsedDoc): string {
  const bits: string[] = []
  if (doc.poNumber) bits.push(`PO ${doc.poNumber}`)
  if (doc.warehouseCode) bits.push(`仓库 ${doc.warehouseCode.toUpperCase()}`)
  if (doc.appointmentDate || doc.shipmentDate) {
    bits.push(`预约 ${formatAppointmentLabel(doc.appointmentDate || doc.shipmentDate!)}`)
  }
  if (doc.sellerName) bits.push(`店铺 ${doc.sellerName}`)
  if (doc.lineItems.length) {
    bits.push(doc.lineItems.map(i => `${i.sku || '?'}×${i.qty}`).join(', '))
  }
  return bits.join(' · ') || '未识别到字段'
}
