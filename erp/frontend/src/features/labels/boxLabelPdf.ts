import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { code128Widths } from '@erp/shared/code128'
import type { BoxLabelData } from './boxLabelTemplate'

const PT_PER_MM = 72 / 25.4
const PAGE_W = 100 * PT_PER_MM
const PAGE_H = 100 * PT_PER_MM
const PAD_X = 3 * PT_PER_MM

function mm(value: number) {
  return value * PT_PER_MM
}

function drawCode128(page: PDFPage, text: string, x: number, y: number, width: number, height: number) {
  const widths = code128Widths(text)
  const modules = widths.reduce((sum, w) => sum + w, 0) || 1
  const unit = width / modules
  let cursor = x
  widths.forEach((w, index) => {
    const barW = w * unit
    if (index % 2 === 0) {
      page.drawRectangle({
        x: cursor,
        y,
        width: Math.max(barW, 0.3),
        height,
        color: rgb(0, 0, 0),
      })
    }
    cursor += barW
  })
}

function drawBoxLabelPage(page: PDFPage, data: BoxLabelData, font: PDFFont, fontBold: PDFFont) {
  const origin = data.origin?.trim() || 'MADE IN CHINA'
  const boxIndex = data.boxIndex ?? data.boxNo
  const boxTotal = data.boxTotal ?? boxIndex
  const lines = data.lines.length ? data.lines : [{ sku: '—', qty: 0 }]
  const tableRight = PAGE_W - PAD_X
  const pcsWidth = mm(14)
  const pcsLeft = tableRight - pcsWidth

  page.drawText('Packing List', {
    x: PAD_X,
    y: PAGE_H - mm(10),
    size: 18,
    font: fontBold,
    color: rgb(0, 0, 0),
  })

  drawCode128(page, data.referenceNo, PAD_X, PAGE_H - mm(26), mm(69), mm(14))
  const boxNo = String(data.boxNo)
  page.drawText(boxNo, {
    x: tableRight - fontBold.widthOfTextAtSize(boxNo, 20),
    y: PAGE_H - mm(24),
    size: 20,
    font: fontBold,
    color: rgb(0, 0, 0),
  })

  page.drawText(data.referenceNo, {
    x: PAD_X + mm(12),
    y: PAGE_H - mm(32),
    size: 10,
    font: fontBold,
    color: rgb(0, 0, 0),
  })

  page.drawText(data.warehouseCode, {
    x: PAD_X + mm(3),
    y: PAGE_H - mm(42),
    size: 20,
    font: fontBold,
    color: rgb(0, 0, 0),
  })

  const headerTop = PAGE_H - mm(46)
  const rowH = mm(6)
  const tableBottom = headerTop - rowH * (1 + lines.length)

  page.drawRectangle({
    x: PAD_X,
    y: tableBottom,
    width: tableRight - PAD_X,
    height: headerTop - tableBottom,
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.8,
  })
  page.drawLine({
    start: { x: pcsLeft, y: tableBottom },
    end: { x: pcsLeft, y: headerTop },
    thickness: 0.8,
    color: rgb(0, 0, 0),
  })
  page.drawLine({
    start: { x: PAD_X, y: headerTop - rowH },
    end: { x: tableRight, y: headerTop - rowH },
    thickness: 0.8,
    color: rgb(0, 0, 0),
  })

  page.drawText('SKU', { x: PAD_X + mm(1.5), y: headerTop - mm(4.2), size: 13, font, color: rgb(0, 0, 0) })
  const pcsHeader = 'PCS'
  page.drawText(pcsHeader, {
    x: pcsLeft + (pcsWidth - font.widthOfTextAtSize(pcsHeader, 13)) / 2,
    y: headerTop - mm(4.2),
    size: 13,
    font,
    color: rgb(0, 0, 0),
  })

  lines.forEach((line, index) => {
    const baseline = headerTop - rowH * (index + 2) + mm(1.8)
    page.drawText(line.sku, {
      x: PAD_X + mm(1.5),
      y: baseline,
      size: 13,
      font,
      color: rgb(0, 0, 0),
      maxWidth: pcsLeft - PAD_X - mm(3),
    })
    const qty = String(line.qty)
    page.drawText(qty, {
      x: pcsLeft + (pcsWidth - font.widthOfTextAtSize(qty, 13)) / 2,
      y: baseline,
      size: 13,
      font,
      color: rgb(0, 0, 0),
    })
    if (index < lines.length - 1) {
      page.drawLine({
        start: { x: PAD_X, y: headerTop - rowH * (index + 2) },
        end: { x: tableRight, y: headerTop - rowH * (index + 2) },
        thickness: 0.6,
        color: rgb(0, 0, 0),
      })
    }
  })

  const footerY = Math.min(tableBottom - mm(12), mm(36))
  const footerRight = `${boxIndex}/${boxTotal}`
  page.drawText(origin, { x: PAD_X, y: footerY, size: 12, font, color: rgb(0, 0, 0) })
  page.drawText(footerRight, {
    x: tableRight - font.widthOfTextAtSize(footerRight, 12),
    y: footerY,
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

  for (const data of labels) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    drawBoxLabelPage(page, data, font, fontBold)
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
