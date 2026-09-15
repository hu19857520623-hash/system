import { findInboundItemByScan } from './inbound-item-scan.util'

const items = [
  { id: 1, sku: '123', productId: 11 },
  { id: 2, sku: 'TKL0001-RED', productId: 22 },
]

describe('findInboundItemByScan', () => {
  it('matches a full SKU', () => {
    expect(findInboundItemByScan(items, 'tkl0001-red', new Map())?.id).toBe(2)
  })

  it('matches a product barcode', () => {
    const barcodes = new Map<number, string>([[22, '6001234567890']])
    expect(findInboundItemByScan(items, ' 6001234567890 ', barcodes)?.id).toBe(2)
  })

  it('does not treat a longer scan as a SKU suffix', () => {
    expect(findInboundItemByScan(items, '690123', new Map())).toBeNull()
  })

  it('does not pick a unique suffix when several SKUs could match', () => {
    const barcodes = new Map<number, string>([[11, '999']])
    expect(findInboundItemByScan(items, 'xx-123', barcodes)).toBeNull()
  })

  it('matches a bound Takealot 990 alias', () => {
    const barcodes = new Map<number, string[]>([[22, ['9902357529948']]])
    expect(findInboundItemByScan(items, '9902357529948', barcodes)?.id).toBe(2)
  })

  it('matches platformBarcode on the inbound line itself', () => {
    const with990 = [{ id: 3, sku: 'CHI0001-RED', productId: 33, platformBarcode: '9902357529948' }]
    expect(findInboundItemByScan(with990, '9902357529948', new Map())?.id).toBe(3)
  })
})
