import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import {
  buildBarcodeLabelArticle,
  buildBarcodeLabelHtml,
  normalizeBarcodeLabelCopies,
  resolveBarcodeLabelCode,
  type BarcodeLabelInput,
} from '@erp/shared/barcode-label'
import { qrModules, qrSvg } from './qr-code'

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

/** 与商品主数据「打印 SKU 标签」同一模板：50×50mm 二维码 + 编码文本 */
export function buildSkuLabelsHtml(
  lines: SkuLabelLine[],
  options: { customerCode?: string | null; title?: string } = {},
) {
  const articles: string[] = []
  for (const item of buildSkuLabelInputs(lines, options.customerCode)) {
    const article = buildBarcodeLabelArticle(item.code, qrSvg(item.code))
    const copies = normalizeBarcodeLabelCopies(item.copies)
    for (let i = 0; i < copies; i += 1) articles.push(article)
  }
  return buildBarcodeLabelHtml(articles.join(''), options.title || 'SKU 标签')
}

const PT_PER_MM = 72 / 25.4
const PAGE_W = 50 * PT_PER_MM
const PAGE_H = 50 * PT_PER_MM

function mm(value: number) {
  return value * PT_PER_MM
}

function expandSkuLabelCodes(lines: SkuLabelLine[], customerCode?: string | null) {
  const codes: string[] = []
  for (const item of buildSkuLabelInputs(lines, customerCode)) {
    const copies = normalizeBarcodeLabelCopies(item.copies)
    for (let i = 0; i < copies; i += 1) codes.push(item.code)
  }
  return codes
}

function drawQr(page: PDFPage, text: string, x: number, y: number, size: number) {
  const modules = qrModules(text)
  const n = modules.size
  const quiet = 1
  const dim = n + quiet * 2
  const cell = size / dim
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) {
      if (!modules.get(row, col)) continue
      page.drawRectangle({
        x: x + (col + quiet) * cell,
        y: y + (dim - 1 - (row + quiet)) * cell,
        width: cell,
        height: cell,
        color: rgb(0, 0, 0),
      })
    }
  }
}

function drawSkuLabelPage(page: PDFPage, code: string, fontBold: PDFFont) {
  const padX = mm(2)
  const padBottom = mm(1.5)
  const textSize = 7
  const textReserve = mm(6)
  const qrSize = Math.min(mm(38), PAGE_W - padX * 2, PAGE_H - mm(2) - padBottom - textReserve)
  const qrX = (PAGE_W - qrSize) / 2
  const qrY = padBottom + textReserve
  drawQr(page, code, qrX, qrY, qrSize)

  let size = textSize
  const maxWidth = PAGE_W - padX * 2
  const natural = fontBold.widthOfTextAtSize(code, size)
  if (natural > maxWidth) size = size * (maxWidth / natural)
  const textW = fontBold.widthOfTextAtSize(code, size)
  page.drawText(code, {
    x: Math.max(padX, (PAGE_W - textW) / 2),
    y: padBottom + mm(1),
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
