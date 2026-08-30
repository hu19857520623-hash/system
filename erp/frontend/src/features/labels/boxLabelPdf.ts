import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { BoxLabelData } from './boxLabelTemplate'

const PT_PER_MM = 72 / 25.4
const PAGE_W = 100 * PT_PER_MM
const PAGE_H = 100 * PT_PER_MM
const PAD_X = 6 * PT_PER_MM
const PAD_TOP = 5 * PT_PER_MM
const PAD_BOTTOM = 4 * PT_PER_MM

function mm(value: number) {
  return value * PT_PER_MM
}

function drawCentered(
  page: PDFPage,
  text: string,
  baselineY: number,
  size: number,
  font: PDFFont,
) {
  const width = font.widthOfTextAtSize(text, size)
  page.drawText(text, {
    x: (PAGE_W - width) / 2,
    y: baselineY,
    size,
    font,
    color: rgb(0, 0, 0),
  })
}

function drawBoxLabelPage(page: PDFPage, data: BoxLabelData, fontBold: PDFFont) {
  const origin = data.origin?.trim() || 'MADE IN CHINA'
  const boxIndex = data.boxIndex ?? data.boxNo
  const boxTotal = data.boxTotal ?? boxIndex
  const lines = data.lines.length ? data.lines : [{ sku: '—', qty: 0 }]

  let cursorY = PAGE_H - PAD_TOP

  drawCentered(page, 'Packing List', cursorY - mm(3), 11, fontBold)
  cursorY -= mm(3 + 2)

  drawCentered(page, data.referenceNo, cursorY - mm(3.5), 10, fontBold)
  cursorY -= mm(3.5 + 3)

  drawCentered(page, String(data.boxNo), cursorY - mm(8), 28, fontBold)
  cursorY -= mm(8 + 2)

  drawCentered(page, data.warehouseCode, cursorY - mm(4), 12, fontBold)
  cursorY -= mm(4 + 4)

  const pcsColRight = PAGE_W - PAD_X
  const pcsColLeft = pcsColRight - mm(18)
  const rowHeight = mm(2.5 + 1.5)

  page.drawText('SKU', { x: PAD_X, y: cursorY - mm(2.5), size: 9, font: fontBold, color: rgb(0, 0, 0) })
  const pcsHeader = 'PCS'
  page.drawText(pcsHeader, {
    x: pcsColRight - fontBold.widthOfTextAtSize(pcsHeader, 9),
    y: cursorY - mm(2.5),
    size: 9,
    font: fontBold,
    color: rgb(0, 0, 0),
  })
  cursorY -= rowHeight

  for (const line of lines) {
    const qtyText = String(line.qty)
    page.drawText(line.sku, {
      x: PAD_X,
      y: cursorY - mm(2.5),
      size: 8.5,
      font: fontBold,
      color: rgb(0, 0, 0),
      maxWidth: pcsColLeft - PAD_X - mm(1),
      lineHeight: mm(3),
    })
    page.drawText(qtyText, {
      x: pcsColRight - fontBold.widthOfTextAtSize(qtyText, 9),
      y: cursorY - mm(2.5),
      size: 9,
      font: fontBold,
      color: rgb(0, 0, 0),
    })
    cursorY -= rowHeight
  }

  const footerRight = `${boxIndex}/${boxTotal}`
  page.drawText(origin, { x: PAD_X, y: PAD_BOTTOM, size: 9, font: fontBold, color: rgb(0, 0, 0) })
  page.drawText(footerRight, {
    x: pcsColRight - fontBold.widthOfTextAtSize(footerRight, 9),
    y: PAD_BOTTOM,
    size: 9,
    font: fontBold,
    color: rgb(0, 0, 0),
  })
}

export async function buildBoxLabelsPdf(labels: BoxLabelData[]): Promise<Uint8Array> {
  if (!labels.length) throw new Error('没有可打印的箱唛')

  const doc = await PDFDocument.create()
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)

  for (const data of labels) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    drawBoxLabelPage(page, data, fontBold)
  }

  return doc.save({ useObjectStreams: true })
}

export async function downloadBoxLabelsPdf(labels: BoxLabelData[], filename: string) {
  const bytes = await buildBoxLabelsPdf(labels)
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  const stem = filename.replace(/\.(html|pdf)$/i, '')
  anchor.download = `${stem}.pdf`
  anchor.click()
  URL.revokeObjectURL(url)
}
