/** 100×100mm 外箱唛（照抄 Takealot receiving_list Packing List） */

import { code128Svg } from '@erp/shared/code128'

export interface BoxLabelLine {
  sku: string
  qty: number
}

export interface BoxLabelData {
  /** 单号，如 RVAFU0002-260413-0001 */
  referenceNo: string
  boxNo: number
  /** 目的仓代码，如 AAB163 */
  warehouseCode: string
  lines: BoxLabelLine[]
  origin?: string
  boxIndex?: number
  boxTotal?: number
}

export function escapeHtml(value: string) {
  return value.replace(/[<>&"]/g, (char) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[char] || char
  ))
}

export const BOX_LABEL_STYLE = `@page{size:100mm 100mm;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}
body{display:block}
.box-label{width:100mm;height:100mm;padding:3mm 3mm 8mm;display:flex;flex-direction:column;page-break-after:always;overflow:hidden}
.title{margin:0;font:700 17.6pt/1.2 Arial,Helvetica,sans-serif;text-align:left}
.barcode-row{display:flex;align-items:flex-start;gap:3mm;margin:1mm 0 1.5mm}
.barcode-wrap{flex:1 1 auto;min-width:0;height:14mm}
.barcode-wrap svg{width:100%;height:14mm;display:block}
.box-no{flex:0 0 12mm;margin:1mm 0 0;font:700 20pt/1 Arial,Helvetica,sans-serif;text-align:right}
.ref{margin:0 0 2mm;padding-left:12mm;font:700 9.6pt/1.2 Arial,Helvetica,sans-serif;letter-spacing:.04em}
.wh{margin:0 0 3mm;padding-left:3mm;font:700 20pt/1.15 Arial,Helvetica,sans-serif}
table{width:100%;border-collapse:collapse;margin:0}
th,td{border:0.35mm solid #000;padding:1.2mm 1.5mm;font:400 12.8pt/1.2 Arial,Helvetica,sans-serif;text-align:left;vertical-align:middle}
th:last-child,td:last-child{text-align:center;width:14mm}
.sku-cell{word-break:break-all}
.footer{margin-top:10mm;display:flex;justify-content:space-between;align-items:flex-end;font:400 12pt/1.2 Arial,Helvetica,sans-serif}
@media print{html,body{width:100mm;height:100mm}.box-label{page-break-inside:avoid}}`

export function buildBoxLabelArticle(data: BoxLabelData) {
  const origin = data.origin?.trim() || 'MADE IN CHINA'
  const boxIndex = data.boxIndex ?? data.boxNo
  const boxTotal = data.boxTotal ?? boxIndex
  const rows = (data.lines.length ? data.lines : [{ sku: '—', qty: 0 }])
    .map(line => `<tr><td class="sku-cell">${escapeHtml(line.sku)}</td><td>${line.qty}</td></tr>`)
    .join('')

  return `<article class="box-label">
  <h1 class="title">Packing List</h1>
  <div class="barcode-row">
    <div class="barcode-wrap">${code128Svg(data.referenceNo)}</div>
    <p class="box-no">${data.boxNo}</p>
  </div>
  <p class="ref">${escapeHtml(data.referenceNo)}</p>
  <p class="wh">${escapeHtml(data.warehouseCode)}</p>
  <table>
    <thead><tr><th>SKU</th><th>PCS</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <footer class="footer"><span>${escapeHtml(origin)}</span><span>${boxIndex}/${boxTotal}</span></footer>
</article>`
}

export function buildBoxLabelsHtml(labels: BoxLabelData[], title = '箱唛') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${BOX_LABEL_STYLE}</style></head><body>${labels.map(buildBoxLabelArticle).join('')}</body></html>`
}

export function printBoxLabels(labels: BoxLabelData[], title = '箱唛') {
  if (!labels.length) {
    window.alert('没有可打印的箱唛')
    return false
  }
  const win = window.open('', '_blank', 'width=720,height=820')
  if (!win) {
    window.alert('浏览器拦截了打印窗口，请允许弹出窗口后重试')
    return false
  }
  win.document.write(buildBoxLabelsHtml(labels, title))
  win.document.close()
  win.focus()
  window.setTimeout(() => win.print(), 200)
  return true
}

export function downloadBoxLabelsHtml(labels: BoxLabelData[], filename: string) {
  const html = buildBoxLabelsHtml(labels, filename)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.endsWith('.html') ? filename : `${filename}.html`
  anchor.click()
  URL.revokeObjectURL(url)
}
