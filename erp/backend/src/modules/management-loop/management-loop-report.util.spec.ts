import {
  accumulateChargeAmounts,
  inboundReportQty,
  outboundReportQty,
  reportLineCbm,
  sumReportCbm,
  userDisplayName,
} from './management-loop-report.util'
import type { ProductDimensionFields } from '../../common/product-dimension.util'

const measured = {
  lengthCm: 10,
  widthCm: 10,
  heightCm: 10,
  measuredLengthCm: 20,
  measuredWidthCm: 20,
  measuredHeightCm: 20,
}

describe('management loop report helpers', () => {
  it('uses measured dims for inbound CBM', () => {
    // 20cm cube × 2 pcs = 0.016 CBM
    expect(reportLineCbm(measured, 2)).toBeCloseTo(0.016, 6)
  })

  it('falls back to declared dims when measured is incomplete', () => {
    expect(
      reportLineCbm(
        { lengthCm: 10, widthCm: 10, heightCm: 10, measuredLengthCm: 20 },
        1,
      ),
    ).toBeCloseTo(0.001, 6)
  })

  it('uses received qty when present, otherwise expected', () => {
    expect(inboundReportQty({ expectedQty: 10, actualQty: 8 })).toBe(8)
    expect(inboundReportQty({ expectedQty: 10, actualQty: null })).toBe(10)
  })

  it('uses picked qty for outbound volume when picking has started', () => {
    expect(outboundReportQty({ qty: 12, pickedQty: 9 })).toBe(9)
    expect(outboundReportQty({ qty: 12, pickedQty: 0 })).toBe(12)
  })

  it('sums CBM across SKUs and ignores cancelled charges', () => {
    const products = new Map<string, ProductDimensionFields>([
      ['1', measured],
      ['2', { lengthCm: 10, widthCm: 10, heightCm: 10 }],
    ])
    expect(
      sumReportCbm(
        [
          { productId: 1, qty: 1 },
          { productId: 2, qty: 1 },
        ],
        products,
      ),
    ).toBe(0.009)

    const amounts = accumulateChargeAmounts([
      { bizRef: 'IB-1', amount: 12.5, status: 'pending' },
      { bizRef: 'IB-1', amount: 3, status: 'confirmed' },
      { bizRef: 'IB-1', amount: 99, status: 'cancelled' },
      { bizRef: 'IB-2', amount: 4 },
    ])
    expect(amounts.get('IB-1')).toBe(15.5)
    expect(amounts.get('IB-2')).toBe(4)
  })

  it('prefers real name for operators', () => {
    expect(userDisplayName({ realName: '张三', username: 'zhangsan' })).toBe('张三')
    expect(userDisplayName({ realName: '', username: 'warehouse' })).toBe('warehouse')
    expect(userDisplayName(null)).toBe('')
  })
})
