export type InboundQcScanPayload = {
  skuToken: string
  increment: number
  lengthCm?: number
  widthCm?: number
  heightCm?: number
}

function positiveNum(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function pickSku(obj: Record<string, unknown>): string {
  return String(obj.sku || obj.SKU || obj.scanCode || obj.barcode || '').trim()
}

function pickIncrement(obj: Record<string, unknown>, fallback: number): number {
  const raw = obj.increment ?? obj.qty ?? obj.count ?? obj.actualQty
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** 解析清点扫描码：纯 SKU、JSON、或 SKU|长|宽|高（测量机常见格式） */
export function parseInboundQcScanInput(
  raw: string,
  incrementOverride?: number,
  dims?: { lengthCm?: unknown; widthCm?: unknown; heightCm?: unknown },
): InboundQcScanPayload {
  const text = String(raw || '').trim()
  if (!text) throw new Error('请扫描或输入 SKU')

  const overrideIncrement = incrementOverride != null && Number(incrementOverride) > 0
    ? Math.floor(Number(incrementOverride))
    : undefined

  const bodyLength = positiveNum(dims?.lengthCm)
  const bodyWidth = positiveNum(dims?.widthCm)
  const bodyHeight = positiveNum(dims?.heightCm)

  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>
      const skuToken = pickSku(obj)
      if (!skuToken) throw new Error('JSON 扫描内容缺少 sku')
      const lengthCm = bodyLength ?? positiveNum(obj.lengthCm ?? obj.length ?? obj.l)
      const widthCm = bodyWidth ?? positiveNum(obj.widthCm ?? obj.width ?? obj.w)
      const heightCm = bodyHeight ?? positiveNum(obj.heightCm ?? obj.height ?? obj.h)
      return {
        skuToken,
        increment: overrideIncrement ?? pickIncrement(obj, 1),
        lengthCm,
        widthCm,
        heightCm,
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        // fall through to plain-text parsers
      } else {
        throw error
      }
    }
  }

  const delimited = text.split(/[|;,]/).map((part) => part.trim()).filter(Boolean)
  if (delimited.length >= 4) {
    const lengthCm = bodyLength ?? positiveNum(delimited[1])
    const widthCm = bodyWidth ?? positiveNum(delimited[2])
    const heightCm = bodyHeight ?? positiveNum(delimited[3])
    if (lengthCm && widthCm && heightCm) {
      const incrementRaw = delimited.length >= 5 ? positiveNum(delimited[4]) : undefined
      return {
        skuToken: delimited[0],
        increment: overrideIncrement ?? (incrementRaw ? Math.floor(incrementRaw) : 1),
        lengthCm,
        widthCm,
        heightCm,
      }
    }
  }

  return {
    skuToken: text,
    increment: overrideIncrement ?? 1,
    lengthCm: bodyLength,
    widthCm: bodyWidth,
    heightCm: bodyHeight,
  }
}
