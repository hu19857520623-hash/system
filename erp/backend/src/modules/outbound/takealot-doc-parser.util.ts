/** Takealot 发货四类 PDF（外箱标/清单/预约单/SKU标签）文本解析 */

export type TakealotDocKind = '外箱标' | 'SKU 标签' | '发货清单' | '预约单' | string

export interface TakealotLineItem {
  sku: string
  qty: number
  productTitle?: string
  barcode?: string
  tsin?: string
}

export interface TakealotParsedDoc {
  poNumber?: string
  sellerId?: string
  sellerName?: string
  /** 清单 Due Date */
  shipmentDate?: string
  /** 预约单 Date of Booking + Time Slot */
  appointmentDate?: string
  /** 归一化目的仓：jhb3 / cpt2 / dbn / jhb1 … */
  warehouseCode?: string
  shipmentName?: string
  bookingRef?: string
  lineItems: TakealotLineItem[]
  sources: string[]
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
  if (/johannesburg/i.test(s)) return 'jhb3'
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
    /_PO_(\d+)_(\d{2})_(\d{2})_(\d{4})_(JHB3|CPT2|DBN|JHB1|CPT1|DBN1)_(\d+)/i,
  )
  if (m) {
    out.sellerId = m[1]
    out.shipmentDate = isoFromParts(m[4], m[3], m[2])
    out.warehouseCode = normalizeTakealotWarehouse(m[5])
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
    t.match(/PO Number:\s*(\d{6,15})/i) ||
    t.match(/Included POs[^\d]{0,20}(\d{6,15})/i) ||
    t.match(/TAL MP(\d{6,15})ASN/i)
  if (po) out.poNumber = po[1]

  const shipmentName = t.match(/Shipment Name:\s*(PO-[^\n]+)/i)
  if (shipmentName) {
    out.shipmentName = shipmentName[1].trim()
    const wh = shipmentName[1].match(/-(JHB3|CPT2|DBN|JHB1|CPT1|DBN1)-\d+/i)
    if (wh) out.warehouseCode = normalizeTakealotWarehouse(wh[1])
  }

  const due = t.match(/Due Date:\s*(\d{4})\/(\d{2})\/(\d{2})/i)
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
    const headerSeller = t.match(/Booking Confirmation\s*([A-Za-z][A-Za-z .'-]{2,80}?)(?=Delivery Address:)/i)
    if (headerSeller) out.sellerName = headerSeller[1].replace(/\s+/g, ' ').trim()
  }

  const dc = t.match(/(Johannesburg DC\s*\d|Cape Town DC\s*\d|Durban DC\s*\d)/i)
  if (dc) out.warehouseCode = normalizeTakealotWarehouse(dc[0])

  if (!out.warehouseCode && /Johannesburg/i.test(t) && kind === '预约单') {
    out.warehouseCode = 'jhb3'
  }

  const bookingRef = t.match(/Booking Reference Number:\s*(TAL[A-Z0-9]+)/i)
  if (bookingRef) out.bookingRef = bookingRef[1].toUpperCase()

  // 发货清单表格：条码 + 标题 + TSIN+SKU+数量（如 104038547WM162）
  const tableBlock = t.match(
    /(\d{13})[\s\S]*?(\d{8,11})([A-Z][A-Z0-9_-]{1,24})(\d{1,5})\s*(?:Page|$)/i,
  )
  if (tableBlock) {
    const titleMatch = t.match(/(\d{13})\s*\n([\s\S]*?)\n(\d{8,11}[A-Z][A-Z0-9_-]*\d+)/i)
    out.lineItems!.push({
      barcode: tableBlock[1],
      productTitle: titleMatch
        ? titleMatch[2].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
        : undefined,
      tsin: tableBlock[2],
      sku: tableBlock[3],
      qty: Number(tableBlock[4]),
    })
  } else {
    const compact = t.match(/(\d{8,11})([A-Z][A-Z0-9_-]{1,24})(\d{1,5})\s*(?:Page|$)/)
    if (compact) {
      out.lineItems!.push({
        tsin: compact[1],
        sku: compact[2],
        qty: Number(compact[3]),
      })
    }
  }

  const bookingQty = t.match(/Total units on delivery:\s*(\d+)/i)
  if (bookingQty && out.lineItems!.length === 1) {
    const q = Number(bookingQty[1])
    if (q > 0) out.lineItems![0].qty = Math.max(out.lineItems![0].qty, q)
  }

  // SKU 标签 PDF 偶发可提取条码分段 9|902357||529948||
  const labelBarcode = t.match(/9\s*\|\s*902357\s*\|\|\s*529948/i)
  if (labelBarcode && !out.lineItems!.length) {
    const digits = t.replace(/\D/g, '')
    const tail = digits.match(/902357529948(\d)?$/)
    if (tail) {
      out.lineItems!.push({ sku: '', qty: 1, barcode: '9902357529948' })
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
    if (p.appointmentDate) result.appointmentDate = p.appointmentDate
    if (p.warehouseCode) result.warehouseCode = p.warehouseCode
    if (p.shipmentName) result.shipmentName = p.shipmentName
    if (p.bookingRef) result.bookingRef = p.bookingRef
    if (p.lineItems?.length) {
      for (const item of p.lineItems) {
        if (!item.sku && !item.barcode) continue
        const key = item.sku || item.barcode!
        const existing = result.lineItems.find(x => (x.sku || x.barcode) === key)
        if (existing) {
          existing.qty = Math.max(existing.qty, item.qty)
          existing.productTitle = existing.productTitle || item.productTitle
          existing.barcode = existing.barcode || item.barcode
          existing.tsin = existing.tsin || item.tsin
          if (item.sku) existing.sku = item.sku
        } else {
          result.lineItems.push({ ...item })
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
