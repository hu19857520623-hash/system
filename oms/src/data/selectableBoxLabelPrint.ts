import { BOX_LABEL_STYLE, type BoxLabelData } from './boxLabelTemplate'
import { buildCartonCode } from './wmsDocNo'
import { renderBarcodeSvg, type LabelCodeType } from './barcodeLabelTemplate'

function escapeHtml(value: string) {
  return value.replace(/[<>&"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[char] || char))
}

export async function buildSelectableBoxLabelHtml(labels: BoxLabelData[], codeType: LabelCodeType) {
  const articles: string[] = []
  for (const label of labels) {
    const lines = label.lines.length ? label.lines : [{ sku: '—', qty: 0 }]
    const cartonCode = buildCartonCode(label.referenceNo, label.boxNo)
    const cartonSvg = await renderBarcodeSvg(cartonCode, codeType)
    for (let offset = 0; offset < lines.length; offset += 2) {
      const rows = await Promise.all(lines.slice(offset, offset + 2).map(async line => {
        const svg = line.sku.trim() && line.sku !== '—' ? await renderBarcodeSvg(line.sku, codeType) : ''
        return `<tr><td class="sku-cell">${escapeHtml(line.sku)}<div class="sku-barcode">${svg}</div></td><td>${line.qty}</td></tr>`
      }))
      articles.push(`<article class="box-label"><h1 class="title">Packing List</h1><div class="barcode-row"><div class="barcode-wrap">${cartonSvg}</div><p class="box-no">${label.boxNo}</p></div><p class="ref">${escapeHtml(cartonCode)}</p><p class="wh">${escapeHtml(label.warehouseCode)}</p><table><thead><tr><th>SKU</th><th>PCS</th></tr></thead><tbody>${rows.join('')}</tbody></table><footer class="footer"><span>${label.boxIndex ?? label.boxNo}/${label.boxTotal ?? label.boxNo}</span></footer></article>`)
    }
  }
  const style = `.sku-cell{height:14mm}.sku-barcode{margin:1mm 2mm 0;height:7mm}.sku-barcode svg{width:100%;height:7mm;display:block}.footer{margin-top:auto;padding-top:1mm;font-size:10pt}`
  const qrStyle = codeType === 'qr' ? `.box-label{padding:3mm}.title{font-size:16pt;line-height:1.1}.barcode-row{margin:1mm 0 .5mm}.barcode-wrap{height:18mm}.barcode-wrap svg{width:18mm;height:18mm}.ref{padding-left:0;margin-bottom:1mm}.wh{font-size:16pt;line-height:1.1;margin-bottom:1mm}.sku-cell{height:20mm}.sku-barcode{height:12mm;margin:.5mm 0 0}.sku-barcode svg{width:12mm;height:12mm}th,td{padding:.8mm 1.5mm}.footer{padding-top:.5mm}` : ''
  return `<!doctype html><html><head><meta charset="utf-8"><title>箱唛</title><style>${BOX_LABEL_STYLE}${style}${qrStyle}</style></head><body>${articles.join('')}</body></html>`
}

export async function printSelectableBoxLabels(labels: BoxLabelData[], codeType: LabelCodeType) {
  if (!labels.length) throw new Error('没有可打印的箱唛')
  const win = window.open('', '_blank', 'width=720,height=820')
  if (!win) throw new Error('浏览器拦截了打印窗口，请允许弹出窗口后重试')
  try {
    win.document.write(await buildSelectableBoxLabelHtml(labels, codeType))
    win.document.close()
    win.focus()
    window.setTimeout(() => win.print(), 200)
    return true
  } catch (error) { win.close(); throw error }
}
