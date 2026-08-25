/** 50×30mm 条码标签：客户代码-SKU，无页眉页脚，紧凑布局（与 OMS 一致） */

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

export const BARCODE_LABEL_STYLE = `@page{size:50mm 30mm;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}
body{display:block}
.label{width:50mm;height:30mm;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1mm 1.5mm 0.5mm;overflow:hidden;page-break-after:always}
.barcode-wrap{flex:1 1 auto;display:flex;align-items:center;justify-content:center;width:100%;min-height:0;max-height:22mm}
.barcode-wrap svg{width:100%;height:auto;max-height:22mm;display:block}
.code{margin:0;padding:0;font:700 8px/1.15 Arial,Helvetica,sans-serif;text-align:center;letter-spacing:.02em;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
@media print{html,body{width:50mm;height:30mm}.label{page-break-inside:avoid}}`

export function buildBarcodeLabelArticle(code: string, svgMarkup: string) {
  return `<article class="label"><div class="barcode-wrap">${svgMarkup}</div><p class="code">${escapeHtml(code)}</p></article>`
}

export function buildBarcodeLabelHtml(articles: string, title = '条码标签') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${BARCODE_LABEL_STYLE}</style></head><body>${articles}</body></html>`
}

export async function renderBarcodeSvg(code: string) {
  const { default: JsBarcode } = await import('jsbarcode')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  try {
    JsBarcode(svg, code, { format: 'CODE128', width: 1.4, height: 48, margin: 0, displayValue: false })
  } catch {
    JsBarcode(svg, code.slice(0, 40), { format: 'CODE128', width: 1.2, height: 44, margin: 0, displayValue: false })
  }
  return svg.outerHTML
}

export async function buildBarcodeLabelsHtml(inputs: BarcodeLabelInput[], title = '条码标签') {
  const articles: string[] = []
  for (const item of inputs) {
    const code = String(item.code || '').trim()
    if (!code) continue
    const svg = await renderBarcodeSvg(code)
    const article = buildBarcodeLabelArticle(code, svg)
    const copies = Math.max(1, Math.min(Number(item.copies) || 1, 500))
    for (let i = 0; i < copies; i += 1) articles.push(article)
  }
  return buildBarcodeLabelHtml(articles.join(''), title)
}

export async function printBarcodeLabels(inputs: BarcodeLabelInput[], title = '条码标签') {
  if (!inputs.length) {
    window.alert('没有可打印的标签')
    return false
  }
  const win = window.open('', '_blank', 'width=520,height=640')
  if (!win) {
    window.alert('浏览器拦截了打印窗口，请允许弹出窗口后重试')
    return false
  }
  const html = await buildBarcodeLabelsHtml(inputs, title)
  win.document.write(html)
  win.document.close()
  win.focus()
  window.setTimeout(() => win.print(), 200)
  return true
}

export function downloadBarcodeLabelHtml(inputs: BarcodeLabelInput[], filename: string) {
  void buildBarcodeLabelsHtml(inputs, filename).then((html) => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename.endsWith('.html') ? filename : `${filename}.html`
    anchor.click()
    URL.revokeObjectURL(url)
  })
}
