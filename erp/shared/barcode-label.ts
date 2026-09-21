/** 50×50mm SKU 标签：二维码 + 编码文本（ERP 前端 / 后端共用布局） */

export interface BarcodeLabelInput {
  /** 条码内容，如 TKL-TK-99001（货盘）或 TKL0001-SKU-xxx（客户持有） */
  code: string
  /** 同一条码打印份数 */
  copies?: number
}

export function escapeHtml(value: string) {
  return value.replace(/[<>&"]/g, (char) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[char] || char
  ))
}

/** 解析条码：优先 barcode 字段，否则 customerCode + sku */
export function resolveBarcodeLabelCode(input: {
  sku: string
  customerCode?: string
  barcode?: string
}): string {
  const explicit = String(input.barcode || '').trim()
  if (explicit) return explicit

  const sku = String(input.sku || '').trim()
  if (!sku) return ''

  const code = String(input.customerCode || '').trim().toUpperCase()
  if (!code && sku.toUpperCase().startsWith('TKL-')) {
    return sku
  }
  if (code && !sku.toUpperCase().startsWith(`${code}-`)) {
    return `${code}-${sku}`
  }
  return sku
}

export const BARCODE_LABEL_STYLE = `@page{size:50mm 50mm;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}
body{display:block}
.label{width:50mm;height:50mm;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2mm 2mm 1.5mm;overflow:hidden;page-break-after:always}
.barcode-wrap{flex:1 1 auto;display:flex;align-items:center;justify-content:center;width:100%;min-height:0;max-height:40mm}
.barcode-wrap svg{width:38mm;height:38mm;display:block}
.code{margin:1mm 0 0;padding:0;font:700 9px/1.15 Arial,Helvetica,sans-serif;text-align:center;letter-spacing:.02em;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
@media print{html,body{width:50mm;height:50mm}.label{page-break-inside:avoid}}`

export function buildBarcodeLabelArticle(code: string, svgMarkup: string) {
  return `<article class="label"><div class="barcode-wrap">${svgMarkup}</div><p class="code">${escapeHtml(code)}</p></article>`
}

export function buildBarcodeLabelHtml(articles: string, title = '条码标签') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${BARCODE_LABEL_STYLE}</style></head><body>${articles}</body></html>`
}

export function normalizeBarcodeLabelCopies(copies?: number) {
  return Math.max(1, Math.min(Number(copies) || 1, 500))
}
