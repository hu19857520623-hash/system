/** Stock counters are deliberately outside metadata revision checks. */
const metadataFields = ['id', 'customerId', 'internalSku', 'customerSku', 'name', 'spec', 'image', 'price', 'cost', 'customCode', 'category', 'categoryPath', 'weight', 'weightKg', 'lengthCm', 'widthCm', 'heightCm', 'inCatalog', 'productStatus', 'productSource', 'hasBattery', 'certUploaded', 'hasBoxSpec', 'outerBoxBarcode', 'declaredNameEn', 'declaredNameCn', 'declaredValue', 'unit'] as const
export function comparableProductMetadata(product: object): string {
  const row = product as Record<string, unknown>
  return JSON.stringify(metadataFields.map(key => row[key] ?? null))
}
export type ProductSaveReceipt = { requestId: string; status: 'unknown' | 'confirmed' | 'cancelled'; productId?: string | null }
