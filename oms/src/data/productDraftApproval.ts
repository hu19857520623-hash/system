import type { Product } from './mockData'
import { getCustomerSkuDisplay, validateCustomerSku } from './skuCode'
import { validateImportedProduct } from './productImportContract'

export function validateProductDrafts(products: Product[], dependencies: {
  customerCodeFor: (customerId?: string) => string
}) {
  const approvedIds: string[] = []
  const failures: { sku: string; error: string }[] = []
  for (const product of products) {
    if (product.inCatalog || !['draft', 'reviewing'].includes(product.productStatus)) continue
    const code = dependencies.customerCodeFor(product.customerId)
    const sku = getCustomerSkuDisplay(product, code)
    try {
      if (!code || code === '—' || code === '全平台') throw new Error('商品未绑定客户编码')
      const skuError = validateCustomerSku(sku)
      if (skuError) throw new Error(skuError)
      if (!product.name.trim()) throw new Error('请填写产品名称')
      if (![product.lengthCm, product.widthCm, product.heightCm].every(value => Number.isFinite(value) && value > 0)) {
        throw new Error('请先编辑草稿，填写有效的长宽高（cm）')
      }
      const invalid = validateImportedProduct(product as unknown as Record<string, unknown>)
      if (invalid) throw new Error(`${invalid}，请先编辑商品资料`)
      approvedIds.push(product.id)
    } catch (error) {
      failures.push({ sku, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { approvedIds, failures }
}

export async function approveProductDrafts(products: Product[], dependencies: {
  customerCodeFor: (customerId?: string) => string
  markAvailable: (ids: string[]) => Promise<unknown>
}) {
  const result = validateProductDrafts(products, dependencies)
  if (result.approvedIds.length) await dependencies.markAvailable(result.approvedIds)
  return result
}
