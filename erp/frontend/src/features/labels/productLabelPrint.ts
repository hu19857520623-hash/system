import {
  printBarcodeLabels,
  resolveBarcodeLabelCode,
  type BarcodeLabelInput,
} from './barcodeLabelTemplate'

export interface ProductLabelItem {
  sku: string
  name?: string
  barcode?: string
  customerCode?: string
}

export function productLabelInputs(items: ProductLabelItem[]): BarcodeLabelInput[] {
  return items.map((product) => ({
    code: resolveBarcodeLabelCode({
      sku: product.sku,
      barcode: product.barcode,
      customerCode: product.customerCode,
    }),
    copies: 1,
  })).filter(item => item.code)
}

export async function printProductSkuLabels(items: ProductLabelItem[]) {
  if (!items.length) {
    window.alert('请先选择要打印条码的产品')
    return false
  }
  const inputs = productLabelInputs(items)
  if (!inputs.length) {
    window.alert('所选商品缺少有效 SKU')
    return false
  }
  return printBarcodeLabels(inputs, 'SKU 标签')
}
