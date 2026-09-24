import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { code128Widths } from './code128'
import type { BoxLabelData } from './boxLabelTemplate'
import { buildCartonCode } from './wmsDocNo'

const PT_PER_MM = 72 / 25.4
const PAGE_W = 100 * PT_PER_MM
const PAGE_H = 100 * PT_PER_MM
const PAD_X = 3 * PT_PER_MM

function mm(value: number) {
  return value * PT_PER_MM
}

function drawCode128(page: PDFPage, text: string, x: number, y: number, width: number, height: number) {
  const widths = code128Widths(text)
  const modules = widths.reduce((sum, item) => sum + item, 0) || 1
  const unit = width / modules
  let cursor = x
  widths.forEach((item, index) => {
    const barWidth = item * unit
    if (index % 2 === 0) {
      page.drawRectangle({
        x: cursor,
        y,
        width: Math.max(barWidth, 0.3),
        height,
        color: rgb(0, 0, 0),
      })
    }
    cursor += barWidth
  })
}

function drawBoxLabelPage(page: PDFPage, data: BoxLabelData, font: PDFFont, fontBold: PDFFont) {
  const boxIndex = data.boxIndex ?? data.boxNo
  const boxTotal = data.boxTotal ?? boxIndex
  const cartonCode = buildCartonCode(data.referenceNo, data.boxNo)
  const lines = data.lines.length ? data.lines : [{ sku: '—', qty: 0 }]
  const tableRight = PAGE_W - PAD_X
  const pcsWidth = mm(14)
  const pcsLeft = tableRight - pcsWidth

  page.drawText('Packing List', { x: PAD_X, y: PAGE_H - mm(10), size: 18, font: fontBold, color: rgb(0, 0, 0) })
  drawCode128(page, cartonCode, PAD_X, PAGE_H - mm(26), mm(69), mm(14))

  const boxNo = String(data.boxNo)
  page.drawText(boxNo, {
    x: tableRight - fontBold.widthOfTextAtSize(boxNo, 20),
    y: PAGE_H - mm(24),
    size: 20,
    font: fontBold,
    color: rgb(0, 0, 0),
  })
  page.drawText(cartonCode, { x: PAD_X + mm(12), y: PAGE_H - mm(32), size: 10, font: fontBold, color: rgb(0, 0, 0) })
  page.drawText(data.warehouseCode, { x: PAD_X + mm(3), y: PAGE_H - mm(42), size: 20, font: fontBold, color: rgb(0, 0, 0) })

  const headerTop = PAGE_H - mm(46)
  const rowHeight = mm(6)
  const tableBottom = headerTop - rowHeight * (1 + lines.length)
  page.drawRectangle({
    x: PAD_X,
    y: tableBottom,
    width: tableRight - PAD_X,
    height: headerTop - tableBottom,
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.8,
  })
  page.drawLine({ start: { x: pcsLeft, y: tableBottom }, end: { x: pcsLeft, y: headerTop }, thickness: 0.8, color: rgb(0, 0, 0) })
  page.drawLine({ start: { x: PAD_X, y: headerTop - rowHeight }, end: { x: tableRight, y: headerTop - rowHeight }, thickness: 0.8, color: rgb(0, 0, 0) })

  page.drawText('SKU', { x: PAD_X + mm(1.5), y: headerTop - mm(4.2), size: 13, font, color: rgb(0, 0, 0) })
  const pcs = 'PCS'
  page.drawText(pcs, { x: pcsLeft + (pcsWidth - font.widthOfTextAtSize(pcs, 13)) / 2, y: headerTop - mm(4.2), size: 13, font, color: rgb(0, 0, 0) })

  lines.forEach((line, index) => {
    const baseline = headerTop - rowHeight * (index + 2) + mm(1.8)
    page.drawText(line.sku, { x: PAD_X + mm(1.5), y: baseline, size: 13, font, color: rgb(0, 0, 0), maxWidth: pcsLeft - PAD_X - mm(3) })
    const qty = String(line.qty)
    page.drawText(qty, { x: pcsLeft + (pcsWidth - font.widthOfTextAtSize(qty, 13)) / 2, y: baseline, size: 13, font, color: rgb(0, 0, 0) })
    if (index < lines.length - 1) {
      page.drawLine({ start: { x: PAD_X, y: headerTop - rowHeight * (index + 2) }, end: { x: tableRight, y: headerTop - rowHeight * (index + 2) }, thickness: 0.6, color: rgb(0, 0, 0) })
    }
  })

  const pageCount = `${boxIndex}/${boxTotal}`
  page.drawText(pageCount, {
    x: tableRight - font.widthOfTextAtSize(pageCount, 12),
    y: Math.min(tableBottom - mm(12), mm(36)),
    size: 12,
    font,
    color: rgb(0, 0, 0),
  })
}

export async function buildBoxLabelsPdf(labels: BoxLabelData[]): Promise<Uint8Array> {
  if (!labels.length) throw new Error('没有可打印的箱唛')
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
  for (const label of labels) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    drawBoxLabelPage(page, label, font, fontBold)
  }
  return doc.save({ useObjectStreams: true })
}

function boxLabelPdfUrl(bytes: Uint8Array) {
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
}

export async function downloadBoxLabelsPdf(labels: BoxLabelData[], filename: string) {
  const url = boxLabelPdfUrl(await buildBoxLabelsPdf(labels))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${filename.replace(/\.(html|pdf)$/i, '')}.pdf`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function openBoxLabelsPdf(labels: BoxLabelData[]) {
  const url = boxLabelPdfUrl(await buildBoxLabelsPdf(labels))
  const win = window.open(url, '_blank')
  if (!win) {
    URL.revokeObjectURL(url)
    window.alert('浏览器拦截了标签预览，请允许弹出窗口后重试')
    return false
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return true
}
