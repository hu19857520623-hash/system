import { lotBatchNo, roundMoney, unitCostRmb } from './inventory-lot-cost.util'

describe('inventory-lot-cost.util', () => {
  it('sums purchase, sea freight and domestic fee per unit', () => {
    expect(unitCostRmb({ costRmb: 3.5, seaFreightPerUnit: 4, domesticFeePerUnit: 0.5 })).toBe(8)
  })

  it('rounds to cents', () => {
    expect(roundMoney(3.333)).toBe(3.33)
    expect(unitCostRmb({ costRmb: '3.5', seaFreightPerUnit: null, domesticFeePerUnit: undefined })).toBe(3.5)
  })

  it('uses inbound no as the batch key', () => {
    expect(lotBatchNo(' IN-123 ')).toBe('IN-123')
    expect(lotBatchNo('')).toBeNull()
  })
})
