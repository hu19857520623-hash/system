import { normalizeOmsAsnCustomerDimensions } from './oms-asn-dimensions.util'

describe('normalizeOmsAsnCustomerDimensions', () => {
  it('keeps complete customer-declared dimensions', () => {
    expect(normalizeOmsAsnCustomerDimensions({
      lengthCm: '61.5',
      widthCm: 42,
      heightCm: 18.25,
    })).toEqual({
      lengthCm: 61.5,
      widthCm: 42,
      heightCm: 18.25,
    })
  })

  it('keeps backward compatibility when an old ASN has no dimensions', () => {
    expect(normalizeOmsAsnCustomerDimensions({})).toBeNull()
  })

  it('rejects partial dimensions instead of corrupting product master data', () => {
    expect(() => normalizeOmsAsnCustomerDimensions({
      lengthCm: 61.5,
      widthCm: 42,
    })).toThrow('长、宽、高必须同时填写且大于 0')
  })
})
