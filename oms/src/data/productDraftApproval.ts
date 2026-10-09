import type { Product } from './mockData'
import { createErpProduct, updateErpProduct } from '../api/erp'
import { getCustomerSkuDisplay, validateCustomerSku } from './skuCode'

type ErpBody = Parameters<typeof createErpProduct>[0]

export async function approveProductDrafts(products: Product[], dependencies: {
  customerCodeFor: (customerId?: string) => string
  markAvailable: (ids: string[]) => Promise<unknown>
  create?: typeof createErpProduct
  update?: typeof updateErpProduct
}) {
  const approvedIds: string[] = []
  const failures: { sku: string; error: string }[] = []
  const create = dependencies.create ?? createErpProduct
  const update = dependencies.update ?? updateErpProduct
  for (const product of products) {
    if (product.inCatalog || product.productStatus !== 'draft') continue
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
      const body: ErpBody = {
        sku: product.internalSku, customerSku: sku, customerCode: code, customerId: product.customerId,
        productName: product.name.trim(), barcode: product.customCode || undefined,
        lengthCm: product.lengthCm, widthCm: product.widthCm, heightCm: product.heightCm,
        weightKg: product.weightKg || undefined, declaredValue: product.declaredValue,
        declaredNameEn: product.declaredNameEn || undefined, declaredNameCn: product.declaredNameCn || undefined,
        unit: product.unit || undefined, costRmb: product.declaredValue, spec: product.declaredNameEn || undefined,
        hasBattery: product.hasBattery,
        imageUrl: product.image.startsWith('/api/erp/product-image/')
          ? product.image.replace('/api/erp/product-image/', '/api/product-dev/images/') : undefined,
      }
      // Updating first makes retrying safe after an ERP success and an OMS persistence failure.
      try { await update(product.internalSku, body) }
      catch (error) {
        if ((error as { status?: number })?.status !== 404) throw error
        await create(body)
      }
      approvedIds.push(product.id)
    } catch (error) {
      failures.push({ sku, error: error instanceof Error ? error.message : String(error) })
    }
  }
  if (approvedIds.length) await dependencies.markAvailable(approvedIds)
  return { approvedIds, failures }
}
