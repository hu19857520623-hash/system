import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { code128Widths } from '@erp/shared/code128'
import {
  normalizeBarcodeLabelCopies,
  renderBarcodeLabelsHtml,
  resolveBarcodeLabelCode,
  type BarcodeLabelInput,
} from '@erp/shared/barcode-label'

export type SkuLabelLine = {
  sku: string
  barcode?: string | null
  qty?: number | null
}

export function buildSkuLabelInputs(
  lines: SkuLabelLine[],
  customerCode?: string | null,
): BarcodeLabelInput[] {
  const inputs: BarcodeLabelInput[] = []
  for (const line of lines || []) {
    const code = resolveBarcodeLabelCode({
      sku: String(line.sku || ''),
      barcode: String(line.barcode || ''),
      customerCode: String(customerCode || ''),
    })
    if (!code) continue
    inputs.push({ code, copies: Math.max(1, Math.floor(Number(line.qty) || 0)) })
  }
  return inputs
}

/** 与商品主数据「打印 SKU 标签」同一模板：50×30mm 条码 + 条码文本 */
export function buildSkuLabelsHtml(
  lines: SkuLabelLine[],
  options: { customerCode?: string | null; title?: string } = {},
) {
  return renderBarcodeLabelsHtml(
    buildSkuLabelInputs(lines, options.customerCode),
    options.title || 'SKU 标签',
  )
}

const PT_PER_MM = 72 / 25.4
const PAGE_W = 50 * PT_PER_MM
const PAGE_H = 30 * PT_PER_MM

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
        width: Math.max(barW, 0.25),
        height,
        color: rgb(0, 0, 0),
      })
    }
    cursor += barW
  })
}

function expandSkuLabelCodes(lines: SkuLabelLine[], customerCode?: string | null) {
  const codes: string[] = []
  for (const item of buildSkuLabelInputs(lines, customerCode)) {
    const copies = normalizeBarcodeLabelCopies(item.copies)
    for (let i = 0; i < copies; i += 1) codes.push(item.code)
  }
  return codes
}

function drawSkuLabelPage(page: PDFPage, code: string, fontBold: PDFFont) {
  const padX = mm(1.5)
  const padBottom = mm(0.5)
  const textSize = 6
  const textReserve = mm(4)
  const barcodeW = PAGE_W - padX * 2
  const barcodeH = Math.min(mm(22), PAGE_H - mm(1) - padBottom - textReserve)
  const barcodeY = padBottom + textReserve
  drawCode128(page, code, padX, barcodeY, barcodeW, barcodeH)

  let size = textSize
  const maxWidth = barcodeW
  const natural = fontBold.widthOfTextAtSize(code, size)
  if (natural > maxWidth) size = size * (maxWidth / natural)
  const textW = fontBold.widthOfTextAtSize(code, size)
  page.drawText(code, {
    x: Math.max(padX, (PAGE_W - textW) / 2),
    y: padBottom + mm(0.6),
    size,
    font: fontBold,
    color: rgb(0, 0, 0),
  })
}

export async function buildSkuLabelsPdfBuffer(
  lines: SkuLabelLine[],
  options: { customerCode?: string | null } = {},
): Promise<Buffer> {
  const codes = expandSkuLabelCodes(lines, options.customerCode)
  if (!codes.length) throw new Error('没有可打印的 SKU 标签')

  const doc = await PDFDocument.create()
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
  for (const code of codes) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    drawSkuLabelPage(page, code, fontBold)
  }
  return Buffer.from(await doc.save({ useObjectStreams: true }))
}
