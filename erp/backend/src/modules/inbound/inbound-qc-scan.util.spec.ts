import { parseInboundQcScanInput } from './inbound-qc-scan.util'

describe('parseInboundQcScanInput', () => {
  it('parses plain sku with increment override', () => {
    expect(parseInboundQcScanInput('SKU-A', 3)).toEqual({
      skuToken: 'SKU-A',
      increment: 3,
    })
  })

  it('parses json payload with dimensions', () => {
    const parsed = parseInboundQcScanInput('{"sku":"SKU-A","lengthCm":10,"widthCm":20,"heightCm":30,"qty":2}')
    expect(parsed).toEqual({
      skuToken: 'SKU-A',
      increment: 2,
      lengthCm: 10,
      widthCm: 20,
      heightCm: 30,
    })
  })

  it('parses pipe-delimited measurement machine output', () => {
    const parsed = parseInboundQcScanInput('SKU-A|12.5|8|6.5')
    expect(parsed).toEqual({
      skuToken: 'SKU-A',
      increment: 1,
      lengthCm: 12.5,
      widthCm: 8,
      heightCm: 6.5,
    })
  })
})
