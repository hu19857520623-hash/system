import { describe, expect, it } from 'vitest'
import { stocktakeImportRows } from './stocktakeImport'

const headers = ['库位', 'SKU', '实盘数量']
const lines = [{ id: 1, locationCode: 'A-01', sku: 'TKL-001' }]
describe('stocktake import validation', () => {
  it('accepts zero and skips blank quantities', () => {
    expect(stocktakeImportRows([headers, ['A-01', 'TKL-001', 0], ['A-02', 'OTHER', '']], lines, () => true)).toEqual([{ id: 1, qty: 0, sourceLineNo: 2 }])
  })

  it('reports all bad fields with source row numbers without applying valid rows', () => {
    const grid = [headers, [], ['', '', '-1'], ['A-02', 'OTHER', '4']]
    expect(() => stocktakeImportRows(grid, lines, () => true, [1, 2, 5, 7])).toThrow(/第 5 行，字段 库位[\s\S]*第 5 行，字段 SKU[\s\S]*第 5 行，字段 实盘数量[\s\S]*第 7 行，字段 库位 \/ SKU/)
  })
  it.each(['-1', '1.5', '2147483648', 'NaN'])('rejects invalid quantity %s', qty => {
    expect(() => stocktakeImportRows([headers, ['A-01', 'TKL-001', qty]], lines, () => true)).toThrow('整数')
  })
  it('rejects duplicate, unmatched, ambiguous and forbidden rows', () => {
    const row = ['A-01', 'TKL-001', 1]
    expect(() => stocktakeImportRows([headers, row, row], lines, () => true)).toThrow('重复')
    expect(() => stocktakeImportRows([headers, row], [], () => true)).toThrow('匹配')
    expect(() => stocktakeImportRows([headers, row], [...lines, ...lines], () => true)).toThrow('匹配')
    expect(() => stocktakeImportRows([headers, row], lines, () => false)).toThrow('账号')
  })
})
