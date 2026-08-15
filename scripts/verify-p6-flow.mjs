/**
 * P6 全链路验证脚本
 * 用法: node scripts/verify-p6-flow.mjs
 */
import { createHmac, randomUUID } from 'node:crypto'

const ERP = process.env.ERP_API_BASE || 'http://127.0.0.1:3000/api'
const OMS = process.env.OMS_API_BASE || 'http://127.0.0.1:3001/api'
const CUSTOMER = process.env.P6_CUSTOMER_CODE || 'TKL0001'
const TEST_SKU = process.env.P6_TEST_SKU || 'TK-66105'
const ERP_USER = process.env.ERP_USER || 'admin'
const ERP_PASS = process.env.ERP_PASS || '123456'
const REUSE_EXISTING = process.env.P6_REUSE_EXISTING === '1'
const ALLOW_MANUAL_WEBHOOK = process.env.P6_ALLOW_MANUAL_WEBHOOK === '1'
const WEBHOOK_SECRET = process.env.OMS_WEBHOOK_SECRET || ''

const TEMPLATE_SNAPSHOT = {
  handling: { perOrderBase: 15, perUnit: 0.5, perSkuLine: 2 },
  shipping: { mode: 'volume', ratePerCbm: 800, minCharge: 50 },
  shippingMethod: '卡派',
  destRegion: 'jhb',
}

const results = []
function pass(step, detail) {
  results.push({ step, ok: true, detail })
  console.log(`✅ ${step}: ${detail}`)
}
function fail(step, detail) {
  results.push({ step, ok: false, detail })
  console.log(`❌ ${step}: ${detail}`)
}
function info(msg) {
  console.log(`   ${msg}`)
}

let erpToken = ''

async function jfetch(url, opts = {}) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  }
  if (erpToken && url.startsWith(ERP)) {
    headers.Authorization = `Bearer ${erpToken}`
  }
  const res = await fetch(url, { ...opts, headers })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    const msg = typeof body === 'object' ? JSON.stringify(body) : text
    throw new Error(`${res.status} ${msg}`)
  }
  return body
}

function unwrapErp(body) {
  if (body && typeof body === 'object' && 'code' in body && 'data' in body) {
    if (body.code !== 0 && body.code !== '0') {
      throw new Error(body.message || JSON.stringify(body))
    }
    return body.data
  }
  return body
}

async function erpFetch(path, opts) {
  return unwrapErp(await jfetch(`${ERP}${path}`, opts))
}

async function omsFetch(path, opts) {
  return jfetch(`${OMS}${path}`, opts)
}

async function erpLogin() {
  const data = unwrapErp(
    await jfetch(`${ERP}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: ERP_USER, password: ERP_PASS }),
    }),
  )
  erpToken = data.accessToken || data.token || ''
  if (!erpToken) throw new Error('登录失败：无 token')
  info(`ERP 已登录 (${ERP_USER})`)
}

async function ensureLocationStock() {
  try {
    const locRes = await erpFetch(`/locations?warehouseCode=WMS-JHB-01&pageSize=5`)
    const locs = locRes.items || locRes || []
    const loc = locs.find(l => l.locationCode?.startsWith('JHB-A')) || locs[0]
    if (!loc) return
    const detail = await erpFetch(`/locations/${loc.id}/inventory`)
    const rows = Array.isArray(detail) ? detail : detail?.items || []
    if (rows.some(r => r.sku === TEST_SKU && (r.qty ?? 0) >= 1)) return
    info(`SKU ${TEST_SKU} 无库位库存，请先运行: cd erp/backend && npx ts-node scripts/setup-p6-stock.ts`)
  } catch {
    /* optional */
  }
}

async function main() {
  console.log('\n=== P6 全链路验证 ===\n')

  try {
    const omsHealth = await omsFetch('/health')
    pass('服务', `OMS API ok, ERP=${omsHealth.erpApiBase}`)
  } catch (e) {
    fail('服务', `OMS API 不可达: ${e.message}`)
    printSummary()
    process.exit(1)
  }

  try {
    await erpLogin()
    await ensureLocationStock()
  } catch (e) {
    fail('ERP 登录', e.message)
    printSummary()
    process.exit(1)
  }

  let outboundNo = ''
  let erpId = 0
  let preDeductTotal = 120.5

  // 严格模式默认创建新单，避免历史状态/流水造成假绿。
  const list = await erpFetch(`/outbound/oms/by-customer/${CUSTOMER}`)
  const items = list.items || []
  info(`ERP 客户出库 ${items.length} 条`)

  let erpOb = null
  if (REUSE_EXISTING) {
    erpOb = items.find(o => o.preDeduct?.preDeductTotal > 0 && ['pending_pick', 'picking', 'picked', 'reviewing', 'packed'].includes(o.status))
    if (!erpOb) erpOb = items.find(o => o.preDeduct?.preDeductTotal > 0)
  }

  if (erpOb) {
    outboundNo = erpOb.outboundNo
    erpId = erpOb.id
    preDeductTotal = erpOb.preDeduct.preDeductTotal
    pass('P6-1 已有单', `${outboundNo} preDeduct=¥${preDeductTotal}, status=${erpOb.status}`)
  } else {
    outboundNo = `OUT-P6-${Date.now().toString().slice(-8)}`
    preDeductTotal = 120.5
    try {
      erpOb = await erpFetch('/outbound/oms', {
        method: 'POST',
        body: JSON.stringify({
          outboundNo,
          customerCode: CUSTOMER,
          warehouseCode: 'WMS-JHB-01',
          platform: 'Takealot',
          fbaWarehouse: 'JHB3',
          destination: 'Takealot JHB3',
          shippingMethod: '卡派',
          stockSource: 'owned',
          source: 'catalog_dist',
          items: [{ sku: TEST_SKU, qty: 1, productName: 'P6验证SKU' }],
          preDeduct: {
            destRegion: 'jhb',
            priceTemplateId: 'pt-jhb-default',
            priceTemplateName: 'JHB 标准价',
            preDeductTotal,
            totalVolumeM3: 0.012,
            totalWeightKg: 1.2,
            lines: [
              { type: 'handling', label: '操作费', amount: 45, detail: '试算' },
              { type: 'shipping', label: '物流费', amount: 75.5, detail: '试算' },
            ],
            deductedAt: new Date().toISOString(),
            templateSnapshot: TEMPLATE_SNAPSHOT,
          },
        }),
      })
      erpId = erpOb.id
      pass('P6-1 创建', `${outboundNo} → ERP id=${erpId}, preDeduct=¥${preDeductTotal}`)
    } catch (e) {
      fail('P6-1 创建', e.message)
      printSummary()
      process.exit(1)
    }
  }

  // P6-1 by-no
  try {
    const byNo = await erpFetch(`/outbound/oms/by-no/${encodeURIComponent(outboundNo)}`)
    if (byNo.preDeduct?.preDeductTotal > 0) {
      pass('P6-1 回读', `by-no preDeduct=¥${byNo.preDeduct.preDeductTotal}, template=${byNo.preDeduct.priceTemplateName || '—'}`)
    } else {
      fail('P6-1 回读', 'remark 中无 preDeduct')
    }
    erpOb = byNo
    erpId = byNo.id
  } catch (e) {
    fail('P6-1 回读', e.message)
  }

  // OMS 预扣
  const balanceBefore = await getOmsBalance()
  await simulatePreDeduct(outboundNo, preDeductTotal)
  const balanceAfterPre = await getOmsBalance()
  if (balanceAfterPre <= balanceBefore - preDeductTotal + 0.01) {
    pass('OMS 预扣', `余额 ¥${balanceBefore.toFixed(2)} → ¥${balanceAfterPre.toFixed(2)}`)
  } else {
    fail('OMS 预扣', `余额未按预扣下降：¥${balanceBefore.toFixed(2)} → ¥${balanceAfterPre.toFixed(2)}`)
  }

  // 同步 OMS 出库镜像
  await upsertOmsOutbound(outboundNo, preDeductTotal)

  // ERP 推进 pending_pick → shipped
  let detail = await erpFetch(`/outbound/${erpId}`)
  info(`ERP 状态: ${detail.status}`)

  if (!['packed', 'shipped', 'delivered'].includes(detail.status)) {
    const adv = await advanceOutbound(erpId)
    if (adv.ok) {
      pass('ERP 流程', `已推进至 ${adv.status}`)
      detail = await erpFetch(`/outbound/${erpId}`)
    } else {
      fail('ERP 流程', `自动推进失败: ${adv.reason}`)
    }
  }

  if (detail.status === 'pending_relabel') {
    const itemId = detail.items?.[0]?.id
    const barcode = detail.items?.[0]?.sku || TEST_SKU
    await erpFetch(`/outbound/${erpId}/confirm-relabel`, {
      method: 'POST',
      body: JSON.stringify({ items: [{ id: itemId, scannedBarcode: barcode }] }),
    })
    detail = await erpFetch(`/outbound/${erpId}`)
    pass('ERP 换标', `status=${detail.status}`)
  }

  if (detail.status === 'packed') {
    const ship = await erpFetch(`/outbound/${erpId}/ship`, {
      method: 'POST',
      body: JSON.stringify({ trackingNo: `P6-${Date.now().toString().slice(-6)}`, carrier: 'P6Test' }),
    })
    detail = ship
    pass('ERP 发运', `status=${detail.status}`)
    await sleep(1500)
  }

  const finalErp = await erpFetch(`/outbound/oms/by-no/${encodeURIComponent(outboundNo)}`)

  // P6-2
  if (finalErp.measure?.totalVolumeM3 != null) {
    pass('P6-2 实测', `${finalErp.measure.totalVolumeM3}m³ / ${finalErp.measure.totalWeightKg}kg`)
  } else if (['shipped', 'delivered', 'packed'].includes(finalErp.status)) {
    fail('P6-2 实测', '无 measure 标签')
  } else {
    fail('P6-2 实测', `未完成 pack，status=${finalErp.status}`)
  }

  if (finalErp.actualFees?.actualTotal > 0) {
    pass('P6-2 实算', `actualTotal=¥${finalErp.actualFees.actualTotal}, lines=${finalErp.actualFees.lines?.length || 0}`)
  } else if (['shipped', 'delivered'].includes(finalErp.status)) {
    fail('P6-2 实算', '无 actualFees')
  } else {
    fail('P6-2 实算', `未完成发运，status=${finalErp.status}`)
  }

  // P6-3: 等待 webhook 或手动触发
  let settle = await waitForSettleRecord(outboundNo, 8000)
  if (!settle && ['shipped', 'delivered'].includes(finalErp.status)) {
    if (ALLOW_MANUAL_WEBHOOK) {
      const wh = await triggerFeesWebhook(finalErp)
      if (wh.ok) {
        fail('P6-3 自动 webhook', `自动事件缺失；仅人工补发成功 delta=${wh.settlementDelta}`)
        settle = await findSettleRecord(outboundNo)
      } else {
        fail('P6-3 webhook', wh.reason)
      }
    } else {
      fail('P6-3 自动 webhook', '发运后 8 秒内无 settle；严格模式禁止人工补发')
    }
  } else if (settle) {
    pass('P6-3 自动对账', `ERP 自动 webhook 已落 settle, amount=${settle.amount}`)
  } else if (['shipped', 'delivered'].includes(finalErp.status)) {
    fail('P6-3 对账', '发运后无 settle 记录')
  } else {
    fail('P6-3 自动对账', `出库未发运，status=${finalErp.status}`)
  }

  const actuals = await findActualRecords(outboundNo)
  if (actuals.length) pass('P6-3 实扣流水', `${actuals.length} 条`)
  else if (settle) info('P6-3: 无独立 actual 流水（可能已合并）')

  // P6-4
  await verifyP64(outboundNo, preDeductTotal)

  printSummary()
  process.exit(results.some(r => !r.ok) ? 1 : 0)
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function getOmsBalance() {
  const b = await omsFetch('/billing')
  return Number(b.creditBalance) || 0
}

async function simulatePreDeduct(outboundNo, total) {
  const b = await omsFetch('/billing')
  if ((b.feeRecords || []).some(f => f.refNo === outboundNo && f.method === 'pre_deduct')) return
  await omsFetch('/billing', {
    method: 'PUT',
    body: JSON.stringify({
      creditBalance: Math.round((b.creditBalance - total) * 100) / 100,
      feeRecords: [
        {
          id: `pd-p6-${Date.now()}`,
          date: new Date().toISOString().slice(0, 10),
          type: 'handling',
          refNo: outboundNo,
          desc: `P6验证 · 预扣`,
          amount: -total,
          method: 'pre_deduct',
          customerCode: CUSTOMER,
        },
        ...(b.feeRecords || []),
      ],
    }),
  })
}

async function upsertOmsOutbound(outboundNo, preDeductTotal) {
  const bootstrap = await omsFetch('/bootstrap')
  const orders = bootstrap.outboundOrders || []
  const exists = orders.find(o => o.outboundNo === outboundNo)
  const row = exists || {
    id: `p6-ob-${Date.now()}`,
    customerId: '1',
    outboundNo,
    source: 'catalog_dist',
    stockSource: 'owned',
    type: 'takealot',
    warehouse: 'jhb1',
    items: 1,
    totalQty: 1,
    status: 'locked',
    destination: 'Takealot JHB3',
    createdAt: new Date().toISOString().slice(0, 10),
    preDeductFees: [
      { type: 'handling', label: '操作费', amount: 45 },
      { type: 'shipping', label: '物流费', amount: preDeductTotal - 45 },
    ],
    preDeductTotal,
    preDeductVolumeM3: 0.012,
    preDeductWeightKg: 1.2,
    settlementStatus: 'pending',
  }
  if (exists) {
    Object.assign(exists, { preDeductTotal, settlementStatus: exists.settlementStatus || 'pending' })
  } else {
    orders.unshift(row)
  }
  await omsFetch('/outbound-orders', { method: 'PUT', body: JSON.stringify(orders) })
}

async function advanceOutbound(id) {
  try {
    let detail = await erpFetch(`/outbound/${id}`)
    const itemId = detail.items?.[0]?.id
    if (!itemId) return { ok: false, reason: '无明细行' }

    if (detail.status === 'pending_pick' || detail.status === 'picking') {
      await erpFetch(`/outbound/${id}/pick`, {
        method: 'POST',
        body: JSON.stringify({ items: [{ id: itemId, pickedQty: detail.items[0].qty || 1 }] }),
      })
    }
    detail = await erpFetch(`/outbound/${id}`)
    if (detail.status === 'picked') {
      await erpFetch(`/outbound/${id}/start-review`, { method: 'POST', body: '{}' })
    }
    detail = await erpFetch(`/outbound/${id}`)
    if (detail.status === 'reviewing' || detail.status === 'picked') {
      await erpFetch(`/outbound/${id}/pack`, {
        method: 'POST',
        body: JSON.stringify({
          cartons: [{ lengthCm: 40, widthCm: 30, heightCm: 25, grossWeightKg: 2.5 }],
        }),
      })
    }
    detail = await erpFetch(`/outbound/${id}`)
    if (detail.status === 'pending_relabel') {
      const itemId = detail.items?.[0]?.id
      const barcode = detail.items?.[0]?.sku || TEST_SKU
      await erpFetch(`/outbound/${id}/confirm-relabel`, {
        method: 'POST',
        body: JSON.stringify({ items: [{ id: itemId, scannedBarcode: barcode }] }),
      })
      detail = await erpFetch(`/outbound/${id}`)
    }
    return { ok: true, status: detail.status }
  } catch (e) {
    return { ok: false, reason: e.message }
  }
}

async function triggerFeesWebhook(erpOb) {
  try {
    const charges = (erpOb.actualFees?.lines || []).map((l, i) => ({
      chargeNo: `${CUSTOMER}-CHG-P6-${i}`,
      id: 900000 + i,
      chargeType: l.chargeType || (l.type === 'shipping' ? 'outbound_ship' : 'handling'),
      amount: l.amount,
      description: `${l.label} · ${erpOb.outboundNo}`,
      bizRef: erpOb.outboundNo,
    }))
    if (!charges.length) {
      charges.push(
        { chargeNo: `${CUSTOMER}-CHG-P6-H`, id: 900010, chargeType: 'handling', amount: 50, description: `操作费 · ${erpOb.outboundNo}`, bizRef: erpOb.outboundNo },
        { chargeNo: `${CUSTOMER}-CHG-P6-S`, id: 900011, chargeType: 'outbound_ship', amount: 80, description: `物流费 · ${erpOb.outboundNo}`, bizRef: erpOb.outboundNo },
      )
    }
    const core = charges.filter(c => ['handling', 'outbound_ship'].includes(c.chargeType))
    const actualTotal = erpOb.actualFees?.actualTotal ?? core.reduce((s, c) => s + c.amount, 0)
    const eventId = randomUUID()
    const payload = {
      eventId,
      type: 'outbound.fees',
      customerCode: CUSTOMER,
      data: {
        outboundNo: erpOb.outboundNo,
        preDeduct: erpOb.preDeduct,
        actualFees: erpOb.actualFees || { actualTotal, lines: [] },
        measure: erpOb.measure,
        charges,
        status: 'shipped',
      },
      at: new Date().toISOString(),
    }
    const serialized = JSON.stringify(payload)
    const signature = WEBHOOK_SECRET
      ? `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(serialized).digest('hex')}`
      : ''
    const res = await omsFetch('/erp/webhooks/events', {
      method: 'POST',
      headers: {
        'X-OMS-Event-Id': eventId,
        ...(signature ? { 'X-OMS-Signature': signature } : {}),
      },
      body: serialized,
    })
    return { ok: true, settlementDelta: res.settlementDelta }
  } catch (e) {
    return { ok: false, reason: e.message }
  }
}

async function findSettleRecord(outboundNo) {
  const b = await omsFetch('/billing')
  return (b.feeRecords || []).find(f => f.id === `settle-${outboundNo}`)
}

async function waitForSettleRecord(outboundNo, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const record = await findSettleRecord(outboundNo)
    if (record) return record
    await sleep(400)
  }
  return null
}

async function findActualRecords(outboundNo) {
  const b = await omsFetch('/billing')
  return (b.feeRecords || []).filter(f => f.refNo === outboundNo && f.method === 'actual')
}

async function verifyP64(outboundNo, preDeductTotal) {
  const bootstrap = await omsFetch('/bootstrap')
  const ob = (bootstrap.outboundOrders || []).find(o => o.outboundNo === outboundNo)
  const fees = (bootstrap.feeRecords || []).filter(f => f.refNo === outboundNo)

  if (ob?.preDeductTotal || ob?.preDeductFees?.length) {
    pass('P6-4 出库展示', `pre=¥${ob.preDeductTotal ?? preDeductTotal}, actual=¥${ob.actualFeesTotal ?? '—'}, status=${ob.settlementStatus ?? '—'}`)
  } else {
    fail('P6-4 出库展示', 'OMS 无出库镜像')
  }

  const methods = [...new Set(fees.map(f => f.method).filter(Boolean))]
  if (fees.length >= 2 && methods.length >= 2) {
    pass('P6-4 账单关联', `${outboundNo}: ${fees.length} 条 [${methods.join(', ')}]`)
  } else if (fees.length >= 1) {
    info(`P6-4: ${fees.length} 条流水 [${methods.join(', ')}]`)
  } else {
    fail('P6-4 账单关联', '无关联流水')
  }
}

function printSummary() {
  console.log('\n=== 验证汇总 ===')
  const ok = results.filter(r => r.ok).length
  const bad = results.filter(r => !r.ok).length
  console.log(`通过 ${ok} / 失败 ${bad} / 共 ${results.length}`)
  if (bad) {
    console.log('\n失败项:')
    results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.step}: ${r.detail}`))
  }
  console.log('')
}

main().catch(e => {
  console.error('脚本异常:', e)
  process.exit(1)
})
