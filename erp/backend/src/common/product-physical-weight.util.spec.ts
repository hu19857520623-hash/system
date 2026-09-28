import { resolveProductPhysicalWeightKg } from './product-physical-weight.util'

describe('resolveProductPhysicalWeightKg', () => {
  it('uses an explicitly supplied package gross weight', () => {
    expect(resolveProductPhysicalWeightKg({ packageWeightKg: 13 })).toBe(13)
  })

  it('uses the first explicit package gross weight across sources', () => {
    expect(resolveProductPhysicalWeightKg(null, { packageWeightKg: 8.5 }, { packageWeightKg: 9 })).toBe(8.5)
  })

  it('does not treat volumetric weight as physical weight', () => {
    expect(resolveProductPhysicalWeightKg({ volumetricWeightKg: 22.529 } as any)).toBeUndefined()
  })

  it('keeps physical weight unset when no package gross weight exists', () => {
    expect(resolveProductPhysicalWeightKg(undefined, {})).toBeUndefined()
  })
})
