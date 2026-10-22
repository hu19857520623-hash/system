export type InboundQcScanPayload = {
  skuToken: string
  increment: number
  lengthCm?: number
  widthCm?: number
  heightCm?: number
  weightKg?: number
}

function numeric(raw: unknown, label: string): number {
  if (typeof raw !== 'number' && !(typeof raw === 'string' && raw.trim())) throw new Error(`${label}须为有效数值`)
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error(`${label}须为有效数值`)
  return value
}
function count(raw: unknown): number {
  const value = numeric(raw, '每次件数')
  if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647) throw new Error('每次件数须为不小于零且未超出范围的整数')
  return value
}
function dimension(raw: unknown, label: string, weight = false): number | undefined {
  if (raw === undefined) return undefined
  const value = numeric(raw, label), precision = weight ? 1000 : 100
  if (value <= 0 || value > (weight ? 99999.999 : 999999.99) || Math.abs(value * precision - Math.round(value * precision)) > 0.0001) throw new Error(`${label}须大于零且不超过${weight ? '99999.999' : '999999.99'}，最多保留${weight ? '三' : '两'}位小数`)
  return value
}

/** Quantity is never rounded or silently replaced; device JSON and separated dimensions share validation. */
export function parseInboundQcScanInput(raw: string, incrementOverride?: number, dims?: { lengthCm?: unknown; widthCm?: unknown; heightCm?: unknown; weightKg?: unknown }): InboundQcScanPayload {
  const text = String(raw || '').trim()
  if (!text) throw new Error('请扫描或输入 SKU')
  let token = text, embedded: Record<string, unknown> = {}
  if (text.startsWith('{')) {
    try { embedded = JSON.parse(text) }
    catch { throw new Error('扫描内容不是有效的 JSON，请重新扫描') }
    if (!embedded || Array.isArray(embedded) || typeof embedded !== 'object') throw new Error('扫描内容须为有效商品资料')
    const code = embedded.sku ?? embedded.SKU ?? embedded.scanCode ?? embedded.barcode
    if (typeof code !== 'string' || !code.trim()) throw new Error('JSON 扫描内容缺少有效 SKU 编码')
    token = code.trim()
  } else if (/[|;,]/.test(text)) {
    const parts = text.split(/[|;,]/).map(part => part.trim())
    if (parts.length >= 4) {
      if (!parts[0]) throw new Error('测量机扫描内容须包含 SKU 和完整长宽高')
      token = parts[0]
      embedded = { lengthCm: parts[1], widthCm: parts[2], heightCm: parts[3], ...(parts.length > 4 ? { increment: parts[4] } : {}) }
    }
  }
  const lengthCm = dimension(dims?.lengthCm ?? embedded.lengthCm ?? embedded.length ?? embedded.l, '长度')
  const widthCm = dimension(dims?.widthCm ?? embedded.widthCm ?? embedded.width ?? embedded.w, '宽度')
  const heightCm = dimension(dims?.heightCm ?? embedded.heightCm ?? embedded.height ?? embedded.h, '高度')
  const weightKg = dimension(dims?.weightKg ?? embedded.weightKg ?? embedded.weight, '重量', true)
  if ([lengthCm, widthCm, heightCm].some(value => value !== undefined) && ![lengthCm, widthCm, heightCm].every(value => value !== undefined)) throw new Error('请提供完整且有效的长、宽、高')
  const increment = incrementOverride !== undefined ? count(incrementOverride) : count(embedded.increment ?? embedded.qty ?? embedded.count ?? embedded.actualQty ?? 1)
  return { skuToken: token, increment, lengthCm, widthCm, heightCm, weightKg }
}
