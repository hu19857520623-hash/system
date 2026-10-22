import { describe, expect, it } from 'vitest'
import { mapLogisticsReceipt } from './mappers'

describe('收货记录数量口径', () => {
  it('良品8和破损2的实收总量显示10，并单列良品与破损', () => {
    expect(mapLogisticsReceipt({ items: [{ actualQty: 8, damagedQty: 2, qcStatus: 'fail' }] })).toMatchObject({ totalQty: 10, goodQty: 8, damagedQty: 2, hasQcIssue: true })
  })
  it('仅破损的收货记录不能显示实收0', () => {
    expect(mapLogisticsReceipt({ items: [{ actualQty: 0, damagedQty: 2, qcStatus: 'fail' }] })).toMatchObject({ totalQty: 2, goodQty: 0, damagedQty: 2 })
  })
})
