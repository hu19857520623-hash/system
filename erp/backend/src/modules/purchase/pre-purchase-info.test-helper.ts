import { toCsv } from '../../common/csv.util'
import { PRE_PURCHASE_INFO_COLUMNS } from './pre-purchase-info.util'

export function validInfoRow(index = 1): Record<string, any> {
  return {
    prePoNo: `PRE-${index}`, sku: `SKU-${index}`, productName: `测试商品${index}`, spec: '标准规格', supplierName: '测试供应商',
    plannedQty: 1, unitPrice: 10,
    productLengthCm: 30, productWidthCm: 20, productHeightCm: 10,
    packageLengthCm: 35, packageWidthCm: 25, packageHeightCm: 15,
  }
}

export function infoCsv(rows: Record<string, any>[], extraKeys: string[] = []) {
  const keys = new Set([...PRE_PURCHASE_INFO_COLUMNS.filter(column => column.required).map(column => column.key), ...extraKeys, ...rows.flatMap(row => Object.keys(row))])
  const columns = PRE_PURCHASE_INFO_COLUMNS.filter(column => keys.has(column.key))
  return toCsv(columns.map(column => column.label), rows.map((row, index) => {
    const data = { ...validInfoRow(index + 1), ...row }
    return columns.map(column => data[column.key] ?? '')
  }))
}
