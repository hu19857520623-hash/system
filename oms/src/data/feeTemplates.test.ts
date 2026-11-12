import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildOutboundTemplateSnapshot, calculateOutboundPreDeduct, DEFAULT_PRICE_TEMPLATE, estimateDailyStorageRent, normalizePriceTemplate, type ChannelShippingRule } from './feeTemplates.ts'

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

describe('收费模板与零金额组合', () => {
  const zeroTemplate = {
    ...DEFAULT_PRICE_TEMPLATE,
    handling: { perOrderBase: 0, perUnit: 0, perSkuLine: 0 },
    shippingByRegion: { jhb: { 卡派: { mode: 'weight', volumetricRatio: 4000, ratePerKg: 0, minCharge: 0 }, 快递: { mode: 'weight', volumetricRatio: 4000, ratePerKg: 0, minCharge: 0 } } },
    pickupByRegion: { jhb: { perOrder: 0, perUnit: 0, minCharge: 0 } },
  } as any

  test('全零模板逐行为 0 且合计为 0，明细仍可核对', () => {
    const result = calculateOutboundPreDeduct([{ sku: 'A', qty: 2 }], '卡派', 'jhb',
      () => ({ lengthCm: 10, widthCm: 10, heightCm: 10, weightKg: 1 }), zeroTemplate)
    assert.equal(result.total, 0)
    assert.deepEqual(result.lines.map(l => l.amount), [0, 0])
    assert.match(result.lines[0].detail, /基础 ¥0 \+ 2 件 × ¥0/)
  })

  test('零费率仍受最低收费约束；免费模板需同时把最低收费置零', () => {
    const result = quote(22.1, { mode: 'weight', volumetricRatio: 4000, ratePerKg: 0, minCharge: 4 })
    assert.equal(result.total, 4)
    assert.match(result.lines[1].detail, /最低收费 ¥4.00/)
    assert.equal(quote(22.1, { mode: 'weight', volumetricRatio: 4000, ratePerKg: 0, minCharge: 0 }).total, 0)
  })

  test('缺失、负数与 NaN 配置一律按 0 处理，不产生负费用或 NaN', () => {
    for (const rule of [
      { mode: 'weight', volumetricRatio: 4000, ratePerKg: -2, minCharge: 4 },
      { mode: 'weight', volumetricRatio: 4000, ratePerKg: NaN, minCharge: NaN },
      { mode: 'weight', volumetricRatio: 4000, ratePerKg: 2, minCharge: undefined },
    ] as any) {
      const result = quote(60, rule)
      assert.ok(Number.isFinite(result.total), `非法配置产生了 ${result.total}`)
      assert.ok(result.total >= 0, `非法配置产生了负费用 ${result.total}`)
    }
    // 负费率被钳制为免费：60kg × -2 不再是 -120
    assert.equal(quote(60, { mode: 'weight', volumetricRatio: 4000, ratePerKg: -2, minCharge: 0 }).total, 0)
    // 缺最低收费不放大成 NaN：60kg × 2 = 120
    assert.equal(quote(60, { mode: 'weight', volumetricRatio: 4000, ratePerKg: 2, minCharge: undefined } as any).total, 120)
  })

  test('零操作费只收物流费；非法操作费被钳制', () => {
    const template = { ...zeroTemplate, handling: { perOrderBase: -5, perUnit: NaN, perSkuLine: 0 },
      shippingByRegion: { jhb: { 卡派: { mode: 'weight', volumetricRatio: 4000, ratePerKg: 2, minCharge: 0 }, 快递: { mode: 'weight', volumetricRatio: 4000, ratePerKg: 2, minCharge: 0 } } } } as any
    const result = calculateOutboundPreDeduct([{ sku: 'A', qty: 1 }], '卡派', 'jhb',
      () => ({ lengthCm: 10, widthCm: 10, heightCm: 10, weightKg: 3 }), template)
    assert.equal(result.lines[0].amount, 0)
    assert.equal(result.total, 6)
  })

  test('自提零金额与非法自提配置都被钳制为合法金额', () => {
    const zero = calculateOutboundPreDeduct([{ sku: 'A', qty: 2 }], '自提', 'jhb',
      () => ({ lengthCm: 10, widthCm: 10, heightCm: 10, weightKg: 1 }), zeroTemplate)
    assert.equal(zero.lines[1].label, '自提费')
    assert.equal(zero.lines[1].amount, 0)
    assert.equal(zero.total, 0)
    const dirty = { ...zeroTemplate, pickupByRegion: { jhb: { perOrder: -8, perUnit: NaN, minCharge: undefined } } } as any
    const clamped = calculateOutboundPreDeduct([{ sku: 'A', qty: 2 }], '自提', 'jhb',
      () => ({ lengthCm: 10, widthCm: 10, heightCm: 10, weightKg: 1 }), dirty)
    assert.equal(clamped.lines[1].amount, 0)
  })

  test('仓租零金额、负值与 NaN 组合均安全', () => {
    const dims = { lengthCm: 10, widthCm: 10, heightCm: 10, weightKg: 1 }
    assert.equal(estimateDailyStorageRent(dims, 3, { billingUnit: 'piece', pricePerCbmPerDay: 0, pricePerPiecePerDay: 0, minChargePerDay: 0 } as any), 0)
    assert.equal(estimateDailyStorageRent(dims, 3, { billingUnit: 'piece', pricePerCbmPerDay: 0, pricePerPiecePerDay: -2, minChargePerDay: 0 } as any), 0)
    assert.equal(estimateDailyStorageRent(dims, 3, { billingUnit: 'volume', pricePerCbmPerDay: NaN, pricePerPiecePerDay: 0, minChargePerDay: 0 } as any), 0)
    assert.equal(estimateDailyStorageRent(dims, 3, { billingUnit: 'piece', pricePerCbmPerDay: 0, pricePerPiecePerDay: 1, minChargePerDay: 2 } as any), 3)
  })

  test('模板规范化清洗负值与 NaN，零值保持为合法免费配置', () => {
    const normalized = normalizePriceTemplate({
      handling: { perOrderBase: -5, perUnit: NaN, perSkuLine: 1.5 },
      shippingByRegion: { jhb: { 卡派: { mode: 'weight', volumetricRatio: 4000, ratePerKg: -2, minCharge: NaN }, 快递: { mode: 'weight', volumetricRatio: 4000, ratePerKg: 0, minCharge: 0 } } },
      pickupByRegion: { jhb: { perOrder: -1, perUnit: 0, minCharge: NaN } },
    } as any)
    assert.deepEqual(normalized.handling, { perOrderBase: 0, perUnit: 0, perSkuLine: 1.5 })
    assert.equal(normalized.shippingByRegion['jhb']!['卡派'].ratePerKg, 0)
    assert.equal(normalized.shippingByRegion['jhb']!['卡派'].minCharge, 0)
    assert.deepEqual(normalized.pickupByRegion['jhb'], { perOrder: 0, perUnit: 0, minCharge: 0 })
  })

  test('零金额模板的快照与预扣一致输出 0，不出现 NaN 或 null', () => {
    const result = quote(1, { mode: 'weight', volumetricRatio: 4000, ratePerKg: 0, minCharge: 0 })
    assert.equal(result.total, 0)
    assert.equal(result.snapshot.shipping.ratePerKg, 0)
    assert.equal(result.snapshot.shipping.minCharge, 0)
  })
})
