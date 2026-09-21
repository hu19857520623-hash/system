/** 50×30mm 条码标签：客户代码-SKU，无页眉页脚，紧凑布局（与 OMS 一致） */
import {
  buildBarcodeLabelArticle,
  buildBarcodeLabelHtml,
  normalizeBarcodeLabelCopies,
  type BarcodeLabelInput,
} from '@erp/shared/barcode-label'

export {
  BARCODE_LABEL_STYLE,
  buildBarcodeLabelArticle,
  buildBarcodeLabelHtml,
  escapeHtml,
  resolveBarcodeLabelCode,
  type BarcodeLabelInput,
} from '@erp/shared/barcode-label'

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
    const copies = normalizeBarcodeLabelCopies(item.copies)
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
