import {
  aliasesForSku,
  indexPlatformBarcodes,
  parseMappingInternalSkus,
  primaryBoundBarcode,
  productScanFields,
  loadPlatformBarcodesByInternalSku,
} from './platform-barcode-lookup.util'

describe('platform-barcode-lookup', () => {
  it('never exposes catalog customer 990 bindings to ERP scan fields', async () => {
    const rows = [
      { stockSource: 'catalog', platformBarcode: '9902380084674', lines: JSON.stringify([{ internalSku: 'SHARED' }]), status: 'active' },
      { stockSource: 'owned', platformBarcode: '9902233754839', lines: JSON.stringify([{ internalSku: 'OWNED' }]), status: 'active' },
    ]
    expect(indexPlatformBarcodes(rows).has('SHARED')).toBe(false)
    const query = jest.fn().mockResolvedValue(rows)
    const indexed = await loadPlatformBarcodesByInternalSku({ $queryRawUnsafe: query }, ['SHARED'])
    expect(query.mock.calls[0][0]).toContain("stockSource = 'owned' AND customerId IS NOT NULL")
    expect(productScanFields('SHARED', { barcode: 'original-erp-barcode' }, indexed)).toEqual({
      barcode: 'original-erp-barcode', platformBarcode: '', platformBarcodes: [],
    })
  })
  it('parses mapping lines JSON', () => {
    expect(
      parseMappingInternalSkus(
        JSON.stringify([{ internalSku: 'CHI0001-FIT-WEI-004', qty: 1 }]),
      ),
    ).toEqual(['CHI0001-FIT-WEI-004'])
  })

  it('indexes active Takealot 990s by warehouse SKU', () => {
    const indexed = indexPlatformBarcodes([
      {
        status: 'active',
        platformBarcode: '9902357529948',
        lines: JSON.stringify([{ internalSku: 'CHI0001-FIT-WEI-004' }]),
      },
      {
        status: 'inactive',
        platformBarcode: '9900000000000',
        lines: JSON.stringify([{ internalSku: 'CHI0001-FIT-WEI-004' }]),
      },
    ])
    expect(indexed.get('CHI0001-FIT-WEI-004')).toEqual(['9902357529948'])
  })

  it('resolves 990 via customer SKU when mapping stored the seller code', () => {
    const indexed = indexPlatformBarcodes([
      {
        status: 'active',
        platformBarcode: '9902357529948',
        lines: JSON.stringify([{ internalSku: 'FIT-WEI-004' }]),
      },
    ])
    expect(aliasesForSku('CHI0001-FIT-WEI-004', indexed, 'FIT-WEI-004')).toEqual(['9902357529948'])
    expect(aliasesForSku('CHI0001-FIT-WEI-004', indexed)).toEqual(['9902357529948'])
  })

  it('prefers a 13-digit 990 for display and keeps product barcode for scan', () => {
    const indexed = indexPlatformBarcodes([
      {
        status: 'active',
        platformBarcode: '9902357529948',
        lines: JSON.stringify([{ internalSku: 'CHI0001-RED' }]),
      },
    ])
    expect(primaryBoundBarcode(['6001234567890', '9902357529948'])).toBe('9902357529948')
    expect(
      productScanFields('CHI0001-RED', { sku: 'CHI0001-RED', barcode: '6001234567890' }, indexed),
    ).toEqual({
      barcode: '6001234567890',
      platformBarcode: '9902357529948',
      platformBarcodes: ['9902357529948'],
    })
  })
})
