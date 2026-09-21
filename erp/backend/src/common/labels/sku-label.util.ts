import {
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
