import test from 'node:test'
import assert from 'node:assert/strict'
import { groupFeeRecordsByOutbound, summarizeOutboundFeeGroups } from './outboundFeeUtils.ts'

function fee(id: string, refNo: string, method: 'pre_deduct' | 'actual' | 'settlement_adjust', amount: number, date = '2026-11-01') {
  return { id, refNo, method, amount, date, type: 'shipping', desc: '测试流水' } as any
}

test('没有出库流水时汇总为全 0，不产生 NaN', () => {
  const summary = summarizeOutboundFeeGroups(groupFeeRecordsByOutbound([]))
  assert.deepEqual(summary, { orderCount: 0, preDeductTotal: 0, actualTotal: 0, settlementAdjustTotal: 0, netChangeTotal: 0, settledCount: 0, pendingCount: 0 })
})

test('预扣、实扣与对账差额分别汇总，单数区分已对账与待对账', () => {
  const records = [
    fee('p1', 'DOTKL9001-261019-0001', 'pre_deduct', -10),
    fee('a1', 'DOTKL9001-261019-0001', 'actual', -15),
    fee('s1', 'DOTKL9001-261019-0001', 'settlement_adjust', -5),
    fee('p2', 'DOTKL9001-261019-0002', 'pre_deduct', -8),
    fee('s2', 'DOTKL9001-261019-0002', 'settlement_adjust', 8),
    fee('p3', 'DOTKL9001-261019-0003', 'pre_deduct', -20),
  ]
  const groups = groupFeeRecordsByOutbound(records)
  const summary = summarizeOutboundFeeGroups(groups)
  assert.equal(summary.orderCount, 3)
  assert.equal(summary.preDeductTotal, 38)
  assert.equal(summary.actualTotal, 15)
  assert.equal(summary.settlementAdjustTotal, 3)
  assert.equal(summary.settledCount, 2)
  assert.equal(summary.pendingCount, 1)
})

test('零金额组合安全：预扣 0 不计待对账，实扣 0 但有对账流水仍算已对账', () => {
  const groups = groupFeeRecordsByOutbound([
    fee('p0', 'DOTKL9001-261019-0004', 'pre_deduct', 0),
    fee('s0', 'DOTKL9001-261019-0005', 'settlement_adjust', 0),
  ])
  const summary = summarizeOutboundFeeGroups(groups)
  assert.equal(summary.orderCount, 2)
  assert.equal(summary.preDeductTotal, 0)
  assert.equal(summary.actualTotal, 0)
  assert.equal(summary.settlementAdjustTotal, 0)
  assert.equal(summary.settledCount, 1)
  assert.equal(summary.pendingCount, 0)
})

test('非出库单号的流水不进入对账分组', () => {
  const groups = groupFeeRecordsByOutbound([
    fee('x1', 'BL-202611-1', 'pre_deduct', -99),
    fee('p1', 'DOTKL9001-261019-0001', 'pre_deduct', -10),
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].outboundNo, 'DOTKL9001-261019-0001')
  assert.equal(summarizeOutboundFeeGroups(groups).preDeductTotal, 10)
})
