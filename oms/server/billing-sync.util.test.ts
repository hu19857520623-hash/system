import test from 'node:test'
import assert from 'node:assert/strict'
import { openPreDeductTotal } from './billing-sync.util.js'
import { mapErpChargeType } from '../src/data/chargeType.js'

test('open pre-deduct total ignores settled and refunded references', () => {
  assert.equal(openPreDeductTotal([]), 0)
  assert.equal(openPreDeductTotal([
    { id: 'pre-1', method: 'pre_deduct', amount: -80, refNo: 'OB-1' },
    { id: 'pre-2', method: 'pre_deduct', amount: -20, refNo: 'OB-2' },
    { id: 'settle-OB-1', method: 'settlement_adjust', amount: 10, refNo: 'OB-1' },
    { id: 'actual-1', method: 'actual', amount: -15, refNo: 'OB-2' },
  ]), 20)
  assert.equal(openPreDeductTotal([
    { id: 'pre-3', method: 'pre_deduct', amount: -50, refNo: 'OB-3' },
    { id: 'refund-OB-3', method: 'settlement_adjust', amount: 50, refNo: 'OB-3' },
  ]), 0)
})

test('maps ERP outbound shipping charges onto OMS shipping fees', () => {
  assert.equal(mapErpChargeType('outbound_ship'), 'shipping')
  assert.equal(mapErpChargeType(''), 'other')
  assert.equal(mapErpChargeType('handling'), 'handling')
})
