import { parseImportResultDetail, serializeImportResultDetail } from './import-row-result.util'

describe('import-row-result.util', () => {
  it('serializes and parses failure rows', () => {
    const raw = serializeImportResultDetail([
      { lineNo: 3, reason: 'SKU 已存在' },
      { lineNo: 5, reason: '开发人未找到' },
    ])
    expect(parseImportResultDetail(raw)).toEqual([
      { lineNo: 3, reason: 'SKU 已存在' },
      { lineNo: 5, reason: '开发人未找到' },
    ])
  })

  it('returns empty for blank detail', () => {
    expect(parseImportResultDetail(null)).toEqual([])
    expect(parseImportResultDetail('')).toEqual([])
  })
})
