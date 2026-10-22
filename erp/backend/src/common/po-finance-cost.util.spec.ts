import {
  allocateAmountByQuantity,
  computePoFinanceApprovalCosts,
  costLedgerSuffix,
  lineIncidentalAmount,
  normalizePoExtraCosts,
} from './po-finance-cost.util'

describe('po-finance-cost.util extra costs', () => {
  it('canonicalizes and merges extra cost rows', () => {
    expect(normalizePoExtraCosts([
      { costType: '包装费', amountRmb: 40 },
      { costType: '税费', amount: 10 },
      { type: '包装费', amountRmb: 20 },
      { costType: '采购货款', amountRmb: 99 },
      { costType: '  ', amountRmb: 5 },
      { costType: '装卸', amountRmb: 8 },
    ])).toEqual([
      { costType: '包装费', amountRmb: 60 },
      { costType: '采购税费', amountRmb: 10 },
      { costType: '装卸费', amountRmb: 8 },
    ])
  })

  it('allocates leftover cents to the last SKU', () => {
    const shares = allocateAmountByQuantity(
      [{ id: 1, quantity: 1 }, { id: 2, quantity: 1 }, { id: 3, quantity: 1 }],
      10,
    )
    expect([...shares.values()]).toEqual([3.33, 3.33, 3.34])
  })

  it('writes packaging and tax into the purchase cost ledger and unit incidental', () => {
    const po = {
      poNo: 'PO-1',
      domesticFreight: 30,
      extraCosts: [
        { costType: '包装费', amountRmb: 12 },
        { costType: '税费', amountRmb: 6 },
      ],
      items: [
        { id: 1, sku: 'A', quantity: 2, unitPrice: 10 },
        { id: 2, sku: 'B', quantity: 2, unitPrice: 20 },
      ],
    }
    const breakdown = computePoFinanceApprovalCosts(po, null)
    expect(breakdown.productTotal).toBe(60)
    expect(breakdown.domesticFreightTotal).toBe(30)
    expect(breakdown.extraTotal).toBe(18)
    expect(breakdown.total).toBe(108)
    expect(breakdown.entries.filter((row) => row.costType === '包装费').map((row) => row.amountRmb)).toEqual([6, 6])
    expect(lineIncidentalAmount(breakdown, po.items[0], po.items)).toBe(15 + 6 + 3)
    expect(costLedgerSuffix('包装费')).toBe('B')
    expect(costLedgerSuffix('装卸费')).toBe('H')
  })
})
