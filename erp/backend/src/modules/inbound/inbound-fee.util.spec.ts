import {
  buildInboundFeeCharge,
  inboundFeeIdempotencyKey,
  inboundFeeRuleMatches,
  pickInboundFeeRule,
} from './inbound-fee.util'

const base = {
  qcUnitPrice: 1,
  measureUnitPrice: 2,
  labelUnitPrice: 0.3,
  putawayUnitPrice: 0.5,
  enabled: true,
}

describe('inbound fee rules', () => {
  it('prefers customer+warehouse over global', () => {
    const picked = pickInboundFeeRule(
      [
        { id: 1, customerId: null, warehouseCode: null, ...base },
        { id: 2, customerId: 9, warehouseCode: 'WMS-JHB-01', ...base, qcUnitPrice: 3 },
        { id: 3, customerId: 9, warehouseCode: null, ...base, qcUnitPrice: 2 },
      ],
      9,
      'WMS-JHB-01',
    )
    expect(picked?.id).toBe(2)
  })

  it('does not apply another customer rule', () => {
    expect(
      inboundFeeRuleMatches(
        { id: 1, customerId: 8, warehouseCode: null, ...base },
        9,
        'WMS-JHB-01',
      ),
    ).toBe(false)
  })

  it('skips zero-amount charges', () => {
    expect(
      buildInboundFeeCharge({
        rule: { id: 1, customerId: 9, warehouseCode: null, ...base, qcUnitPrice: 0 },
        operation: 'qc',
        quantity: 10,
        inboundNo: 'IB-1',
      }),
    ).toBeNull()
  })

  it('builds qc charge against inbound no', () => {
    const charge = buildInboundFeeCharge({
      rule: { id: 4, customerId: 9, warehouseCode: 'WMS-JHB-01', ...base },
      operation: 'qc',
      quantity: 12,
      inboundNo: 'IB-100',
    })
    expect(charge).toMatchObject({
      chargeType: 'inbound_qc',
      amount: 12,
      quantity: 12,
      description: '入库清点 · IB-100 · 12 件',
      idempotencyKey: inboundFeeIdempotencyKey('IB-100', 'qc'),
    })
  })
})
