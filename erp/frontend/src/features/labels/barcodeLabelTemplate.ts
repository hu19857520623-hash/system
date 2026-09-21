/** 50×50mm SKU 标签：二维码 + 编码文本 */
import { create as createQr } from 'qrcode'
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

function qrSvg(code: string, quiet = 1) {
  const payload = String(code || '').trim() || '0'
  const modules = createQr(payload, { errorCorrectionLevel: 'M' }).modules
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
  const label = payload.replace(/[<>&"]/g, (char) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[char] || char
  ))
  return `<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="${label}">${rects.join('')}</svg>`
}

export async function renderBarcodeSvg(code: string) {
  return qrSvg(code)
}

export async function buildBarcodeLabelsHtml(inputs: BarcodeLabelInput[], title = '条码标签') {
  const articles: string[] = []
  for (const item of inputs) {
    const code = String(item.code || '').trim()
    if (!code) continue
    const article = buildBarcodeLabelArticle(code, qrSvg(code))
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
