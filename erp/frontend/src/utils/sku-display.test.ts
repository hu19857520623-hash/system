import { describe, expect, it } from 'vitest'
import { displaySku, displaySkuText, formatSku } from '@erp/shared/sku-display'

describe('SKU display without changing identity', () => {
  it('prefers the custom SKU while preserving the selected object', () => {
    const row = { sku: 'TKL005-710545-2', customerSku: '710545' }
    expect(displaySku(row)).toBe('710545')
    expect(row.sku).toBe('TKL005-710545-2')
  })
  it('strips known prefixes and keeps arbitrary SKU segments intact', () => {
    expect(displaySku('TKL005-710667-2')).toBe('710667-2')
    expect(displaySku('ABC-710667-2')).toBe('ABC-710667-2')
    expect(displaySku('ABC-710667-2', 'ABC')).toBe('710667-2')
    expect(displaySku('DOTKL005-261008-0001')).toBe('DOTKL005-261008-0001')
    expect(displaySku('9902301890599')).toBe('9902301890599')
  })
  it('formats summaries and errors without changing document numbers', () => {
    const summary = 'TKL005-A ×2、TKL0444-B ×3'
    expect(formatSku({}, { property: 'skuSummary' }, summary)).toBe('A ×2、B ×3')
    expect(displaySkuText('DOTKL005-261008-0001：TKL005-A 缺货')).toBe('DOTKL005-261008-0001：A 缺货')
  })
})
