export const PRODUCT_IMPORT_LIMIT = 500

export function validateImportedProduct(row: Record<string, unknown>): string | undefined {
  for (const [key, label] of [['customerSku', '客户SKU'], ['name', '产品名称'], ['declaredNameEn', '英文申报品名'], ['declaredNameCn', '中文申报品名'], ['unit', '单位']]) {
    if (typeof row[key] !== 'string' || !String(row[key]).trim()) return `请填写${label}`
  }
  if (String(row.customerSku).trim().length >= 12) return '客户SKU须少于12位'
  for (const key of ['declaredValue', 'weightKg', 'lengthCm', 'widthCm', 'heightCm']) {
    if (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || Number(row[key]) <= 0) return '申报价值与重量/尺寸须为大于0的数字'
  }
  return undefined
}
