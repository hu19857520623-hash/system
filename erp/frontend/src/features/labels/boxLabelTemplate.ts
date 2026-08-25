/** 100×100mm 外箱唛（Packing List 版式，与 Takealot receiving list 一致） */

export interface BoxLabelLine {
  sku: string
  qty: number
}

export interface BoxLabelData {
  /** 单号，如 RVAFU0002-260731-0003 */
  referenceNo: string
  boxNo: number
  /** 目的仓代码，如 AAE938 */
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
.box-label{width:100mm;height:100mm;padding:5mm 6mm 4mm;display:flex;flex-direction:column;page-break-after:always;overflow:hidden}
.title{margin:0 0 2mm;font:700 11pt/1.1 Arial,Helvetica,sans-serif;text-align:center;letter-spacing:.02em}
.ref{margin:0 0 3mm;font:700 10pt/1.15 Arial,Helvetica,sans-serif;text-align:center;word-break:break-all}
.box-no{margin:0 0 2mm;font:700 28pt/1 Arial,Helvetica,sans-serif;text-align:center}
.wh{margin:0 0 4mm;font:700 12pt/1.1 Arial,Helvetica,sans-serif;text-align:center;letter-spacing:.04em}
table{width:100%;border-collapse:collapse;margin:0 0 auto;flex:0 0 auto}
th,td{padding:1.5mm 1mm;font:700 9pt/1.2 Arial,Helvetica,sans-serif;text-align:left;vertical-align:top}
th:last-child,td:last-child{text-align:right;width:18mm}
.sku-cell{word-break:break-all;font:700 8.5pt/1.25 Arial,Helvetica,sans-serif}
.footer{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;font:700 9pt/1.2 Arial,Helvetica,sans-serif;padding-top:3mm}
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
  <p class="ref">${escapeHtml(data.referenceNo)}</p>
  <p class="box-no">${data.boxNo}</p>
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
