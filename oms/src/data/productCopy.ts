import type { Product } from './mockData'

/** 复制商品资料作为新草稿模板，不复制标识、库存、货盘发布或证书状态。 */
export function productCopyTemplate(source: Product): Product {
  return {
    id: '', customerId: source.customerId, internalSku: '', customerSku: '',
    name: source.name, spec: source.spec, image: source.image,
    price: 0, cost: source.cost, availableQty: 0, lockedQty: 0,
    customCode: source.customCode, category: source.category, categoryPath: source.categoryPath,
    weight: source.weight, weightKg: source.weightKg,
    lengthCm: source.lengthCm, widthCm: source.widthCm, heightCm: source.heightCm,
    inCatalog: false, productStatus: 'draft', productSource: 'manual',
    hasBattery: source.hasBattery, certUploaded: false, hasBoxSpec: source.hasBoxSpec,
    declaredNameEn: source.declaredNameEn, declaredNameCn: source.declaredNameCn,
    declaredValue: source.declaredValue, unit: source.unit,
  }
}
