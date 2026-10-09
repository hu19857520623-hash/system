import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOutboundTemplateSnapshot, calculateOutboundPreDeduct, DEFAULT_PRICE_TEMPLATE, type ChannelShippingRule } from './feeTemplates.ts'

function quote(weightKg: number, rule: ChannelShippingRule, channel = '卡派') {
  const template = { ...DEFAULT_PRICE_TEMPLATE, handling: { perOrderBase: 0, perUnit: 0, perSkuLine: 0 },
    shippingByRegion: { jhb: { 卡派: rule, 快递: rule } } }
  const result = calculateOutboundPreDeduct([{ sku: 'A', qty: 1 }], channel, 'jhb',
    () => ({ lengthCm: 100, widthCm: 100, heightCm: 16.50326, weightKg }), template)
  return { ...result, snapshot: buildOutboundTemplateSnapshot(template, 'jhb', channel) }
}

test('screenshot quote uses volumetric weight and explains the historical minimum of 4', () => {
  const result = quote(22.1, { mode: 'weight', volumetricRatio: 4000, ratePerKg: 0.02, minCharge: 4 })
  assert.equal(result.total, 4)
  assert.match(result.lines[1].detail, /实重 22.10 kg \/ 抛重 41.26 kg/)
  assert.match(result.lines[1].detail, /¥0.83；最低收费 ¥4.00，应收 ¥4.00/)
})

test('a heavier physical weight is used for both truck and express quotes', () => {
  for (const channel of ['卡派', '快递']) {
    const result = quote(60, { mode: 'weight', volumetricRatio: 4000, ratePerKg: 2, minCharge: 4 }, channel)
    assert.equal(result.total, 120)
    assert.match(result.lines[1].detail, /取大计费 60.00 kg/)
    assert.equal(result.snapshot.shipping.ratePerKg, 2)
  }
})

test('with no minimum the low configured rate yields 0.83, not 4', () => {
  assert.equal(quote(22.1, { mode: 'weight', volumetricRatio: 4000, ratePerKg: 0.02, minCharge: 0 }).total, 0.83)
})

test('legacy volume templates use the same comparison and emit a weight snapshot', () => {
  const result = quote(60, { mode: 'volume', volumetricRatio: 4000, ratePerCbm: 500, minCharge: 0 })
  assert.equal(result.total, 120)
  assert.equal(result.snapshot.shipping.mode, 'weight')
  assert.equal(result.snapshot.shipping.ratePerKg, 2)
})
