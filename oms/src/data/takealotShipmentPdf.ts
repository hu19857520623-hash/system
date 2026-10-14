import { parseTakealotDocumentText, type TakealotDocKind, type TakealotLineItem } from './takealotDocParser'
import type { TakealotPdfTextModel } from './takealotPdfText'

/** Read shipping-table columns in PDF coordinates so wrapped titles cannot become Units. */
export function parseTakealotDocumentModel(model: TakealotPdfTextModel, kind: TakealotDocKind) {
  const parsed = parseTakealotDocumentText(model.text, kind)
  if (kind !== '发货清单') return parsed
  const items: TakealotLineItem[] = []
  const issues: string[] = []
  let hasTable = false
  for (const page of model.pages) {
    const tsinHeader = page.tokens.find(token => /^TSIN$/i.test(token.text))
    const skuHeader = page.tokens.find(token => /^SKU$/i.test(token.text))
    const unitsHeader = page.tokens.find(token => /^Units$/i.test(token.text))
    const titleHeader = page.tokens.find(token => /^Product\s+Title$/i.test(token.text))
    if (!tsinHeader || !skuHeader || !unitsHeader || !titleHeader) {
      if (page.tokens.some(token => /^990\d{10}$/.test(token.text))) {
        issues.push(`第 ${page.pageNumber} 页缺少完整的发货清单表头，请核对原文件`)
      }
      continue
    }
    hasTable = true
    const barcodes = page.tokens.filter(token => /^\d{13}$/.test(token.text)
      && token.x < titleHeader.x && token.y < unitsHeader.y).sort((a, b) => b.y - a.y)
    for (const [index, barcode] of barcodes.entries()) {
      const row = page.tokens.filter(token => Math.abs(token.y - barcode.y) <= 3)
      const tsin = row.find(token => token.x >= tsinHeader.x - 3 && token.x < skuHeader.x - 3)?.text
      const sku = row.find(token => token.x >= skuHeader.x - 3 && token.x < unitsHeader.x - 3)?.text
      const units = row.find(token => token.x >= unitsHeader.x - 3)?.text
      if (!sku || !units || !/^\d+$/.test(units) || Number(units) <= 0) {
        issues.push(`${barcode.text}：无法读取 SKU 或 Units，请核对发货清单`)
        continue
      }
      const top = index ? (barcodes[index - 1].y + barcode.y) / 2 : unitsHeader.y - 3
      const bottom = barcodes[index + 1] ? (barcodes[index + 1].y + barcode.y) / 2
        : barcode.y - (index ? barcodes[index - 1].y - barcode.y : 60) / 2
      const title = page.tokens.filter(token => token.x >= titleHeader.x - 3 && token.x < tsinHeader.x - 3
        && token.y < top && token.y > bottom).sort((a, b) => b.y - a.y || a.x - b.x)
        .map(token => token.text).join(' ')
      items.push({ barcode: barcode.text, tsin, sku, qty: Number(units), expectedQty: Number(units), productTitle: title || undefined })
    }
  }
  if (hasTable) parsed.lineItems = items
  if (issues.length) parsed.parsingIssues = issues
  return parsed
}
