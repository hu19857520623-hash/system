/** 50×30mm 条码标签：客户代码-SKU，无页眉页脚，紧凑布局（与 ERP 一致） */

export interface BarcodeLabelInput {
  code: string
  copies?: number
}

function escapeHtml(value: string) {
  return value.replace(/[<>&"]/g, (char) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[char] || char
  ))
}

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

export async function renderBarcodeSvg(code: string) {
  const { create } = await import('qrcode')
  const payload = String(code || '').trim() || '0'
  const modules = create(payload, { errorCorrectionLevel: 'M' }).modules
  const quiet = 1
  const n = modules.size
  const dim = n + quiet * 2
  const rects: string[] = []
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (modules.get(y, x)) {
        rects.push(`<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>`)
      }
    }
  }
  const label = payload.replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch] || ch))
  return `<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="${label}">${rects.join('')}</svg>`
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
