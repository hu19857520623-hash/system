import {
  catalogBaseSkuFromInternal,
  catalogSkuLookupKeys,
  isCatalogInternalSku,
  toCatalogInternalSku,
} from './catalog-customer.util'

describe('toCatalogInternalSku', () => {
  it('prefixes a 选品 SKU', () => {
    expect(toCatalogInternalSku('TK-00003')).toBe('TKL-TK-00003')
  })

  it('prefixes a raw customer sku', () => {
    expect(toCatalogInternalSku('001010')).toBe('TKL-001010')
  })

  it('does not double-prefix', () => {
    expect(toCatalogInternalSku('TKL-001010')).toBe('TKL-001010')
    expect(toCatalogInternalSku('TKL-TK-00003')).toBe('TKL-TK-00003')
  })
})

describe('catalogBaseSkuFromInternal', () => {
  it('strips TKL-', () => {
    expect(catalogBaseSkuFromInternal('TKL-TK-00003')).toBe('TK-00003')
    expect(catalogBaseSkuFromInternal('TK-00003')).toBe('TK-00003')
  })
})

describe('catalogSkuLookupKeys', () => {
  it('returns both internal and base forms', () => {
    expect(catalogSkuLookupKeys('TK-00003').sort()).toEqual(['TK-00003', 'TKL-TK-00003'].sort())
    expect(catalogSkuLookupKeys('TKL-001010').sort()).toEqual(['001010', 'TKL-001010'].sort())
  })
})

describe('isCatalogInternalSku', () => {
  it('detects TKL prefix only', () => {
    expect(isCatalogInternalSku('TKL-001010')).toBe(true)
    expect(isCatalogInternalSku('TK-00003')).toBe(false)
  })
})
