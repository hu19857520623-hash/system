/**
 * ERP/OMS 全链路数据审计脚本。
 *
 * 仅创建带 E2E 前缀的审计数据，不清理、不调用 prisma db push/seed，
 * 不手工触发 webhook。通过 AUDIT_PHASE=sku|outbound 控制阶段。
 */
import { createHash } from 'node:crypto'

const ERP = process.env.ERP_API_BASE || 'http://127.0.0.1:3000/api'
const OMS = process.env.OMS_API_BASE || 'http://127.0.0.1:3001/api'
const RUN_ID = process.env.AUDIT_RUN_ID || '20260811-1732'
const SKU = process.env.AUDIT_SKU || `E2E-${RUN_ID}`
const CUSTOMER_CODE = process.env.AUDIT_CUSTOMER_CODE || 'TKL0001'
const PHASE = process.env.AUDIT_PHASE || 'sku'
const OUTBOUND_SUFFIX = process.env.AUDIT_OUTBOUND_SUFFIX || 'MAIN'
const PRODUCT_NAME = `全链路审计商品 ${RUN_ID}`
const PO_QTY = 20
const INBOUND_QTY = 12
const PURCHASE_QTY = 4

let token = ''
const evidence = {
  runId: RUN_ID,
  sku: SKU,
  customerCode: CUSTOMER_CODE,
  phase: PHASE,
  steps: [],
  ids: {},
  values: {},
  assertions: [],
  findings: [],
}

function step(name, data) {
  evidence.steps.push({ name, data })
  console.log(`\n[${evidence.steps.length}] ${name}`)
  console.log(JSON.stringify(data, null, 2))
  return data
}

function assert(name, ok, detail) {
  evidence.assertions.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`)
  if (!ok) throw new Error(`${name}: ${detail}`)
}

async function request(url, init = {}, unwrap = false) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  }
  if (token && url.startsWith(ERP)) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, { ...init, headers })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${url} -> ${res.status} ${text}`)
  if (unwrap && body && typeof body === 'object' && 'code' in body) {
    if (body.code !== 0 && body.code !== '0') throw new Error(`${init.method || 'GET'} ${url} -> ${body.message}`)
    return body.data
  }
  return body
}

function erp(path, init) {
  return request(`${ERP}${path}`, init, true)
}

function oms(path, init) {
  return request(`${OMS}${path}`, init, false)
}

async function login() {
  const result = await erp('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: '123456' }),
  })
  token = result.token || result.accessToken
  assert('ERP 管理员登录', Boolean(token), '已取得 JWT')
}

async function skuAndInboundPhase() {
  await login()

  const baseline = await Promise.all([
    erp(`/customers/oms/by-code/${CUSTOMER_CODE}`),
    oms('/billing'),
    erp(`/inventory?warehouseCode=WMS-JHB-01&keyword=${encodeURIComponent(SKU)}&pageSize=20`),
  ])
  step('基线', {
    erpBalance: baseline[0].balance,
    omsBalance: baseline[1].creditBalance,
    existingSkuInventory: baseline[2].items || [],
  })
  evidence.values.erpBalanceBefore = Number(baseline[0].balance)
  evidence.values.omsBalanceBefore = Number(baseline[1].creditBalance)

  const dev = await erp('/product-dev', {
    method: 'POST',
    body: JSON.stringify({
      sku: SKU,
      productName: PRODUCT_NAME,
      spec: 'E2E 蓝色 1件装',
      productLengthCm: 18,
      productWidthCm: 12,
      productHeightCm: 8,
      packageLengthCm: 20,
      packageWidthCm: 15,
      packageHeightCm: 10,
      estimatedCost: 12.5,
      marketPrice: 139,
      sellPriceRmb: 49.9,
      maxSellPriceRmb: 59.9,
      seaFreightChannel: '海运普船',
      reason: `[E2E run=${RUN_ID}] 全链路数据审计`,
      takealotUrl: `https://example.invalid/takealot/${RUN_ID}`,
      alibaba1688Url: `https://example.invalid/1688/${RUN_ID}`,
    }),
  })
  evidence.ids.productDevId = Number(dev.id)
  step('产品开发草稿', { id: Number(dev.id), applyNo: dev.applyNo, sku: dev.sku, status: dev.status })

  const submitted = await erp(`/product-dev/${dev.id}/submit`, { method: 'POST', body: '{}' })
  assert('产品开发提交', submitted.status === 'submitted', `status=${submitted.status}`)

  const approved = await erp(`/product-dev/${dev.id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ purchaseQty: PO_QTY, remark: `[E2E run=${RUN_ID}] 审核通过` }),
  })
  assert('产品开发审核', approved.status === 'approved' && approved.sku === SKU, `status=${approved.status}, sku=${approved.sku}`)

  const pending = await erp(`/purchase-orders/pre-purchase/pending-assign?keyword=${encodeURIComponent(SKU)}&pageSize=20`)
  const prePo = (pending.items || []).find(row => row.sku === SKU)
  assert('生成预采购单', Boolean(prePo), `prePo=${prePo?.prePoNo || 'missing'}`)
  evidence.ids.prePoId = prePo.id

  await erp(`/purchase-orders/pre-purchase/${prePo.id}/assign`, {
    method: 'POST',
    body: JSON.stringify({ purchaserId: 5 }),
  })
  const prePoUpdated = await erp(`/purchase-orders/pre-purchase/${prePo.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      supplierId: 1,
      unitPrice: 12.5,
      plannedQty: PO_QTY,
      domesticFreight: 40,
      warehouseCode: 'LW-SZ-01',
      currency: 'RMB',
      expectedArrival: '2026-08-20',
      spec: 'E2E 蓝色 1件装',
      productLengthCm: 18,
      productWidthCm: 12,
      productHeightCm: 8,
      packageLengthCm: 20,
      packageWidthCm: 15,
      packageHeightCm: 10,
      packageWeightKg: 0.8,
      piecesPerCarton: 10,
      productLink: `https://example.invalid/product/${RUN_ID}`,
      remark: `[E2E run=${RUN_ID}] 专用测试记录保留`,
    }),
  })
  assert(
    '预采购字段完整',
    prePoUpdated.productVolumeCbm === 0.001728 && prePoUpdated.packageVolumeCbm === 0.003,
    `productCbm=${prePoUpdated.productVolumeCbm}, packageCbm=${prePoUpdated.packageVolumeCbm}`,
  )

  const converted = await erp(`/purchase-orders/pre-purchase/${prePo.id}/confirm`, { method: 'POST', body: '{}' })
  evidence.ids.poId = converted.poId
  evidence.ids.poNo = converted.poNo
  assert('预采购转正式 PO', converted.status === 'pending_actual_qty', `${converted.poNo}, status=${converted.status}`)

  await erp(`/purchase-orders/${converted.poId}/set-actual-qty`, {
    method: 'POST',
    body: JSON.stringify({ quantity: PO_QTY, remark: `[E2E run=${RUN_ID}] 实采 ${PO_QTY}` }),
  })
  await erp(`/purchase-orders/${converted.poId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ warehouseCode: 'LW-SZ-01', remark: `[E2E run=${RUN_ID}] 采购审核通过` }),
  })
  const finance = await erp(`/purchase-orders/${converted.poId}/finance-approve`, {
    method: 'POST',
    body: JSON.stringify({ remark: `[E2E run=${RUN_ID}] 财务审核通过` }),
  })
  assert('采购财务审核', finance.status === 'finance_approved', `status=${finance.status}`)

  const products = await erp(`/products?keyword=${encodeURIComponent(SKU)}&pageSize=20`)
  const product = (products.items || []).find(row => row.sku === SKU)
  assert('Product 主数据生成', Boolean(product), `productId=${product?.id || 'missing'}`)
  evidence.ids.productId = product.id
  step('Product 主数据', {
    id: product.id,
    sku: product.sku,
    productName: product.productName,
    spec: product.spec,
    lengthCm: product.lengthCm,
    widthCm: product.widthCm,
    heightCm: product.heightCm,
    weightKg: product.weightKg,
    costRmb: product.costRmb,
    status: product.status,
    syncStatus: product.syncStatus,
  })

  const poDetail = await erp(`/purchase-orders/${converted.poId}`)
  const poItem = poDetail.items[0]
  const receipt = await erp('/logistics-receipts', {
    method: 'POST',
    body: JSON.stringify({
      poId: converted.poId,
      warehouseCode: 'LW-SZ-01',
      remark: `[E2E run=${RUN_ID}] 中转仓收货`,
      items: [{
        poItemId: poItem.id,
        sku: SKU,
        actualQty: PO_QTY,
        damagedQty: 0,
        qcStatus: 'pass',
      }],
    }),
  })
  evidence.ids.receiptNo = receipt.receiptNo
  step('中转仓收货', { receiptNo: receipt.receiptNo, warehouseCode: receipt.warehouseCode })

  const logInv = await erp(`/inventory?warehouseType=logistics&warehouseCode=LW-SZ-01&keyword=${encodeURIComponent(SKU)}&pageSize=20`)
  const logRow = (logInv.items || []).find(row => row.sku === SKU)
  assert('中转仓库存', logRow?.availableQty >= PO_QTY, `available=${logRow?.availableQty}`)

  const inboundNo = `IN-E2E-${RUN_ID}`
  const warehouseNo = `WH-E2E-${RUN_ID}`
  const inbound = await erp('/inbound', {
    method: 'POST',
    body: JSON.stringify({
      inboundNo,
      poId: converted.poId,
      sourceWarehouseCode: 'LW-SZ-01',
      warehouseCode: 'WMS-JHB-01',
      warehouseNo,
      trackingNo: `TRK-IN-${RUN_ID}`,
      remark: `[E2E run=${RUN_ID}] 海外仓入库`,
      items: [{ productId: product.id, sku: SKU, expectedQty: INBOUND_QTY }],
      cartons: [{ boxCode: `BOX-${RUN_ID}-01`, items: [{ sku: SKU, qty: INBOUND_QTY }] }],
      freightLines: [{
        sku: SKU,
        productName: PRODUCT_NAME,
        spec: 'E2E 蓝色 1件装',
        inboundQty: INBOUND_QTY,
        seaFreightPerUnit: 3.2,
        domesticFeePerUnit: 2,
        costRmb: 12.5,
      }],
    }),
  })
  evidence.ids.inboundId = inbound.id
  evidence.ids.inboundNo = inboundNo
  step('海外仓入库单', { id: inbound.id, inboundNo, warehouseNo, status: inbound.status })

  const blocked = await fetch(`${ERP}/inbound/${inbound.id}/start-receive`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  }).then(async res => ({ status: res.status, body: await res.json() }))
  assert('到仓前禁止收货', blocked.status === 400, `http=${blocked.status}, message=${blocked.body.message}`)

  const scanned = await erp('/inbound/arrival-scan', {
    method: 'POST',
    body: JSON.stringify({ scanCode: warehouseNo, warehouseCode: 'WMS-JHB-01' }),
  })
  assert('到仓扫描', scanned.order.status === 'arrived', `status=${scanned.order.status}`)

  await erp(`/inbound/${inbound.id}/start-receive`, { method: 'POST', body: '{}' })
  const inboundDetail = await erp(`/inbound/${inbound.id}`)
  const inboundItem = inboundDetail.items[0]
  await erp(`/inbound/${inbound.id}/scan-receipt-label`, {
    method: 'POST',
    body: JSON.stringify({ scanCode: SKU }),
  })
  const qc = await erp(`/inbound/${inbound.id}/qc`, {
    method: 'POST',
    body: JSON.stringify({
      acceptDiff: false,
      items: [{ id: inboundItem.id, sku: SKU, actualQty: INBOUND_QTY, qcStatus: 'pass', qcRemark: `[E2E run=${RUN_ID}] QC pass` }],
    }),
  })
  assert('收货 QC', qc.status === 'pending_putaway', `status=${qc.status}`)

  await erp(`/inbound/${inbound.id}/measure-dimensions`, {
    method: 'POST',
    body: JSON.stringify({ items: [{ inboundItemId: inboundItem.id, lengthCm: 20, widthCm: 15, heightCm: 10 }] }),
  })
  const putaway = await erp(`/inbound/${inbound.id}/putaway`, {
    method: 'POST',
    body: JSON.stringify({
      items: [{ inboundItemId: inboundItem.id, locationCode: 'JHB-A-01-02', qty: INBOUND_QTY }],
    }),
  })
  assert('海外仓上架', putaway.status === 'completed', `status=${putaway.status}`)

  const wmsInv = await erp(`/inventory?warehouseCode=WMS-JHB-01&keyword=${encodeURIComponent(SKU)}&pageSize=20`)
  const wmsRow = (wmsInv.items || []).find(row => row.sku === SKU)
  assert('海外仓库存', wmsRow?.availableQty === INBOUND_QTY, `available=${wmsRow?.availableQty}`)
  step('库存基线完成', {
    logisticsAvailableAfterShip: logRow.availableQty - INBOUND_QTY,
    wmsAvailable: wmsRow.availableQty,
    wmsLocked: wmsRow.lockedQty,
    location: 'JHB-A-01-02',
  })

  const pricingList = await erp(`/pricing?pageSize=100`)
  let pricing = (pricingList.items || []).find(row => row.sku === SKU)
  assert('生成货盘定价记录', Boolean(pricing), `pricingId=${pricing?.id || 'missing'}, status=${pricing?.pricingStatus}`)
  evidence.ids.pricingId = pricing.id
  if (pricing.pricingStatus === 'waiting_freight') {
    pricing = await erp(`/pricing/${pricing.id}/freight-callback`, {
      method: 'POST',
      body: JSON.stringify({ inboundNo, seaFreight: 3.2, domesticFee: 2 }),
    })
  }
  if (pricing.pricingStatus === 'pending_pricing') {
    pricing = await erp(`/pricing/${pricing.id}/confirm`, {
      method: 'POST',
      body: JSON.stringify({
        marketPrice: 139,
        pricingLogic: 'E2E 成本加成',
        targetProfitRate: 0.3,
        finalPrice: 49.9,
        visibleStockQty: INBOUND_QTY,
        overseasDeliveryFee: 8,
        platformCommission: 0.15,
        platformDeliveryFee: 5,
      }),
    })
  }
  pricing = await erp(`/pricing/${pricing.id}/sync-oms`, { method: 'POST', body: '{}' })
  assert('货盘同步 OMS', pricing.pricingStatus === 'synced', `status=${pricing.pricingStatus}`)

  const catalog = await oms('/erp/catalog')
  const catalogSku = (catalog.items || []).find(row => row.sku === SKU)
  assert('OMS Catalog 可见', Boolean(catalogSku), `visible=${catalogSku?.visibleOnOms}, orderable=${catalogSku?.orderableOnOms}`)
  step('OMS Catalog SKU', catalogSku)

  const purchaseNo = `CAT-E2E-${RUN_ID}`
  const purchase = await oms('/erp/purchase', {
    method: 'POST',
    body: JSON.stringify({
      orderNo: purchaseNo,
      customerCode: CUSTOMER_CODE,
      customerId: '1',
      sku: SKU,
      quantity: PURCHASE_QTY,
      unitPrice: 49.9,
    }),
  })
  evidence.ids.purchaseNo = purchase.orderNo
  assert('OMS 货盘申购', purchase.quantity === PURCHASE_QTY, `qty=${purchase.quantity}, idempotent=${purchase.idempotent}`)

  const purchaseRetry = await oms('/erp/purchase', {
    method: 'POST',
    body: JSON.stringify({
      orderNo: purchaseNo,
      customerCode: CUSTOMER_CODE,
      customerId: '1',
      sku: SKU,
      quantity: PURCHASE_QTY,
      unitPrice: 49.9,
    }),
  })
  assert('货盘申购幂等', purchaseRetry.idempotent === true, `idempotent=${purchaseRetry.idempotent}`)

  const customerAfter = await erp(`/customers/oms/by-code/${CUSTOMER_CODE}`)
  const billingAfter = await oms('/billing')
  evidence.values.erpBalanceAfterPurchase = Number(customerAfter.balance)
  evidence.values.omsBalanceAfterPurchase = Number(billingAfter.creditBalance)
  evidence.values.catalogPurchaseAmount = 49.9 * PURCHASE_QTY
  step('SKU/入库阶段结果', {
    ids: evidence.ids,
    balances: {
      erpBefore: evidence.values.erpBalanceBefore,
      erpAfter: evidence.values.erpBalanceAfterPurchase,
      omsBefore: evidence.values.omsBalanceBefore,
      omsAfter: evidence.values.omsBalanceAfterPurchase,
    },
    catalogSku,
  })
}

async function resumeSkuAndInboundPhase() {
  await login()
  const products = await erp(`/products?keyword=${encodeURIComponent(SKU)}&pageSize=20`)
  const product = (products.items || []).find(row => row.sku === SKU)
  assert('恢复 Product 主数据', Boolean(product), `productId=${product?.id || 'missing'}`)
  evidence.ids.productId = product.id

  const logInv = await erp(`/inventory?warehouseType=logistics&warehouseCode=LW-SZ-01&keyword=${encodeURIComponent(SKU)}&pageSize=20`)
  const logRow = (logInv.items || []).find(row => row.sku === SKU)
  if (!logRow) {
    evidence.findings.push({
      priority: 'P0',
      category: '显示缺失',
      title: '中转仓库存 API 隐藏已收货库存',
      detail: `SKU ${SKU} 已在 inventory 表有 20 件，但 /inventory?warehouseType=logistics 返回空`,
    })
    step('中转仓库存查询缺口', { apiItems: logInv.items || [], expectedSku: SKU })
  }

  const poList = await erp(`/purchase-orders?pageSize=100`)
  const po = (poList.items || []).find(row => row.items?.some(item => item.sku === SKU))
  assert('恢复采购单', Boolean(po), `po=${po?.poNo || 'missing'}`)
  evidence.ids.poId = po.id
  evidence.ids.poNo = po.poNo

  const inboundNo = `IN-E2E-${RUN_ID}`
  const warehouseNo = `WH-E2E-${RUN_ID}`
  const inboundList = await erp(`/inbound?pageSize=100`)
  let inbound = (inboundList.items || []).find(row => row.inboundNo === inboundNo)
  if (!inbound) {
    inbound = await erp('/inbound', {
      method: 'POST',
      body: JSON.stringify({
        inboundNo,
        poId: po.id,
        sourceWarehouseCode: 'LW-SZ-01',
        warehouseCode: 'WMS-JHB-01',
        warehouseNo,
        trackingNo: `TRK-IN-${RUN_ID}`,
        remark: `[E2E run=${RUN_ID}] 海外仓入库`,
        items: [{ productId: product.id, sku: SKU, expectedQty: INBOUND_QTY }],
        cartons: [{ boxCode: `BOX-${RUN_ID}-01`, items: [{ sku: SKU, qty: INBOUND_QTY }] }],
        freightLines: [{
          sku: SKU,
          productName: PRODUCT_NAME,
          spec: 'E2E 蓝色 1件装',
          inboundQty: INBOUND_QTY,
          seaFreightPerUnit: 3.2,
          domesticFeePerUnit: 2,
          costRmb: 12.5,
        }],
      }),
    })
  }
  evidence.ids.inboundId = inbound.id
  evidence.ids.inboundNo = inboundNo
  step('海外仓入库单', { id: inbound.id, inboundNo, warehouseNo, status: inbound.status })

  const blocked = await fetch(`${ERP}/inbound/${inbound.id}/start-receive`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  }).then(async res => ({ status: res.status, body: await res.json() }))
  assert('到仓前禁止收货', blocked.status === 400, `http=${blocked.status}, message=${blocked.body.message}`)

  const scanned = await erp('/inbound/arrival-scan', {
    method: 'POST',
    body: JSON.stringify({ scanCode: warehouseNo, warehouseCode: 'WMS-JHB-01' }),
  })
  assert('到仓扫描', scanned.order.status === 'arrived', `status=${scanned.order.status}`)

  await erp(`/inbound/${inbound.id}/start-receive`, { method: 'POST', body: '{}' })
  const inboundDetail = await erp(`/inbound/${inbound.id}`)
  const inboundItem = inboundDetail.items[0]
  await erp(`/inbound/${inbound.id}/scan-receipt-label`, {
    method: 'POST',
    body: JSON.stringify({ scanCode: SKU }),
  })
  const qc = await erp(`/inbound/${inbound.id}/qc`, {
    method: 'POST',
    body: JSON.stringify({
      acceptDiff: false,
      items: [{ id: inboundItem.id, sku: SKU, actualQty: INBOUND_QTY, qcStatus: 'pass', qcRemark: `[E2E run=${RUN_ID}] QC pass` }],
    }),
  })
  assert('收货 QC', qc.status === 'pending_putaway', `status=${qc.status}`)

  await erp(`/inbound/${inbound.id}/measure-dimensions`, {
    method: 'POST',
    body: JSON.stringify({ items: [{ inboundItemId: inboundItem.id, lengthCm: 20, widthCm: 15, heightCm: 10 }] }),
  })
  const putaway = await erp(`/inbound/${inbound.id}/putaway`, {
    method: 'POST',
    body: JSON.stringify({
      items: [{ inboundItemId: inboundItem.id, locationCode: 'JHB-A-01-02', qty: INBOUND_QTY }],
    }),
  })
  assert('海外仓上架', putaway.status === 'completed', `status=${putaway.status}`)

  const wmsInv = await erp(`/inventory?warehouseCode=WMS-JHB-01&keyword=${encodeURIComponent(SKU)}&pageSize=20`)
  const wmsRow = (wmsInv.items || []).find(row => row.sku === SKU)
  assert('海外仓库存', wmsRow?.availableQty === INBOUND_QTY, `available=${wmsRow?.availableQty}`)
  step('库存基线完成', {
    wmsAvailable: wmsRow.availableQty,
    wmsLocked: wmsRow.lockedQty,
    location: 'JHB-A-01-02',
  })

  const pricingList = await erp(`/pricing?pageSize=100`)
  let pricing = (pricingList.items || []).find(row => row.sku === SKU)
  assert('生成货盘定价记录', Boolean(pricing), `pricingId=${pricing?.id || 'missing'}, status=${pricing?.pricingStatus}`)
  evidence.ids.pricingId = pricing.id
  if (pricing.pricingStatus === 'waiting_freight') {
    pricing = await erp(`/pricing/${pricing.id}/freight-callback`, {
      method: 'POST',
      body: JSON.stringify({ inboundNo, seaFreight: 3.2, domesticFee: 2 }),
    })
  }
  if (pricing.pricingStatus === 'pending_pricing') {
    pricing = await erp(`/pricing/${pricing.id}/confirm`, {
      method: 'POST',
      body: JSON.stringify({
        marketPrice: 139,
        pricingLogic: 'E2E 成本加成',
        targetProfitRate: 0.3,
        finalPrice: 49.9,
        visibleStockQty: INBOUND_QTY,
        overseasDeliveryFee: 8,
        platformCommission: 0.15,
        platformDeliveryFee: 5,
      }),
    })
  }
  pricing = await erp(`/pricing/${pricing.id}/sync-oms`, { method: 'POST', body: '{}' })
  assert('货盘同步 OMS', pricing.pricingStatus === 'synced', `status=${pricing.pricingStatus}`)

  const catalog = await oms('/erp/catalog')
  const catalogSku = (catalog.items || []).find(row => row.sku === SKU)
  assert('OMS Catalog 可见', Boolean(catalogSku), `visible=${catalogSku?.visibleOnOms}, orderable=${catalogSku?.orderableOnOms}`)
  step('OMS Catalog SKU', catalogSku)

  const erpBefore = await erp(`/customers/oms/by-code/${CUSTOMER_CODE}`)
  const omsBefore = await oms('/billing')
  evidence.values.erpBalanceBeforePurchase = Number(erpBefore.balance)
  evidence.values.omsBalanceBeforePurchase = Number(omsBefore.creditBalance)
  const purchaseNo = `CAT-E2E-${RUN_ID}`
  const purchase = await oms('/erp/purchase', {
    method: 'POST',
    body: JSON.stringify({
      orderNo: purchaseNo,
      customerCode: CUSTOMER_CODE,
      customerId: '1',
      sku: SKU,
      quantity: PURCHASE_QTY,
      unitPrice: 49.9,
    }),
  })
  evidence.ids.purchaseNo = purchase.orderNo
  assert('OMS 货盘申购', purchase.quantity === PURCHASE_QTY, `qty=${purchase.quantity}, idempotent=${purchase.idempotent}`)

  const purchaseRetry = await oms('/erp/purchase', {
    method: 'POST',
    body: JSON.stringify({
      orderNo: purchaseNo,
      customerCode: CUSTOMER_CODE,
      customerId: '1',
      sku: SKU,
      quantity: PURCHASE_QTY,
      unitPrice: 49.9,
    }),
  })
  assert('货盘申购幂等', purchaseRetry.idempotent === true, `idempotent=${purchaseRetry.idempotent}`)

  const customerAfter = await erp(`/customers/oms/by-code/${CUSTOMER_CODE}`)
  const billingAfter = await oms('/billing')
  evidence.values.erpBalanceAfterPurchase = Number(customerAfter.balance)
  evidence.values.omsBalanceAfterPurchase = Number(billingAfter.creditBalance)
  evidence.values.catalogPurchaseAmount = 49.9 * PURCHASE_QTY
  assert(
    '货盘申购余额',
    Math.abs((evidence.values.erpBalanceBeforePurchase - evidence.values.erpBalanceAfterPurchase) - evidence.values.catalogPurchaseAmount) < 0.001,
    `ERP ${evidence.values.erpBalanceBeforePurchase} -> ${evidence.values.erpBalanceAfterPurchase}`,
  )
  step('SKU/入库阶段结果', {
    ids: evidence.ids,
    balances: {
      erpBefore: evidence.values.erpBalanceBeforePurchase,
      erpAfter: evidence.values.erpBalanceAfterPurchase,
      omsBefore: evidence.values.omsBalanceBeforePurchase,
      omsAfter: evidence.values.omsBalanceAfterPurchase,
    },
    catalogSku,
  })
}

async function delay(ms) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitFor(label, fn, timeoutMs = 12000) {
  const started = Date.now()
  let value
  while (Date.now() - started < timeoutMs) {
    value = await fn()
    if (value) return value
    await delay(400)
  }
  throw new Error(`${label} timeout after ${timeoutMs}ms`)
}

async function outboundPhase() {
  await login()
  const outboundNo = `OUT-E2E-${RUN_ID}-${OUTBOUND_SUFFIX}`
  const before = await Promise.all([
    erp(`/outbound/oms/by-no/${encodeURIComponent(outboundNo)}`),
    erp(`/customers/oms/by-code/${CUSTOMER_CODE}`),
    oms('/billing'),
  ])
  const erpOrder = before[0]
  evidence.ids.outboundId = erpOrder.id
  evidence.ids.outboundNo = outboundNo
  evidence.values.erpBalanceBeforeOutbound = Number(before[1].balance)
  evidence.values.omsBalanceAfterPreDeduct = Number(before[2].creditBalance)
  step('OMS→ERP 出库回读', {
    id: erpOrder.id,
    outboundNo: erpOrder.outboundNo,
    status: erpOrder.status,
    omsStatus: erpOrder.omsStatus,
    customerCode: erpOrder.customerCode,
    stockSource: erpOrder.stockSource,
    warehouseCode: erpOrder.warehouseCode,
    destination: erpOrder.destination,
    shippingMethod: erpOrder.shippingMethod,
    fbaNo: erpOrder.fbaNo,
    fbaWarehouse: erpOrder.fbaWarehouse,
    sellerStoreName: erpOrder.sellerStoreName,
    takealotSellerId: erpOrder.takealotSellerId,
    takealotBookingRef: erpOrder.takealotBookingRef,
    shipmentDueDate: erpOrder.shipmentDueDate,
    appointmentDate: erpOrder.appointmentDate,
    preDeduct: erpOrder.preDeduct,
    items: erpOrder.items,
  })
  assert('OMS 预扣完整进入 ERP', erpOrder.preDeduct?.preDeductTotal === 42.4, `pre=${erpOrder.preDeduct?.preDeductTotal}`)
  assert(
    'OMS 元数据进入 ERP',
    erpOrder.recipient
      ? erpOrder.recipient.name === 'P1 Audit Recipient' &&
        erpOrder.recipient.phone === '+27-82-000-0001'
      : erpOrder.sellerStoreName === `E2E Store ${RUN_ID}` &&
        erpOrder.takealotSellerId === `SELLER-${RUN_ID}` &&
        erpOrder.takealotBookingRef === `BOOK-${RUN_ID}`,
    JSON.stringify({
      sellerStoreName: erpOrder.sellerStoreName,
      takealotSellerId: erpOrder.takealotSellerId,
      takealotBookingRef: erpOrder.takealotBookingRef,
      recipient: erpOrder.recipient,
    }),
  )

  let detail = await erp(`/outbound/${erpOrder.id}`)
  await erp('/outbound/assign-picker', {
    method: 'POST',
    body: JSON.stringify({ ids: [erpOrder.id], pickerId: 11 }),
  })
  detail = await erp(`/outbound/${erpOrder.id}`)
  assert('分配拣货员', detail.status === 'picking' && detail.pickerId === 11, `status=${detail.status}, pickerId=${detail.pickerId}`)

  const suggestion = await erp(`/outbound/${erpOrder.id}/pick-suggestions`)
  step('拣货建议', suggestion)
  const item = detail.items[0]
  const picked = await erp(`/outbound/${erpOrder.id}/pick`, {
    method: 'POST',
    body: JSON.stringify({
      pickSource: 'pda',
      items: [{ id: item.id, locationCode: 'JHB-A-01-02', pickedQty: 2 }],
    }),
  })
  assert('库位拣货', picked.status === 'picked', `status=${picked.status}`)

  const reviewing = await erp(`/outbound/${erpOrder.id}/start-review`, { method: 'POST', body: '{}' })
  assert('开始复核', reviewing.status === 'reviewing', `status=${reviewing.status}`)

  const packed = await erp(`/outbound/${erpOrder.id}/pack`, {
    method: 'POST',
    body: JSON.stringify({
      reviewSource: 'pda',
      isPalletized: false,
      palletInfo: '',
      cartons: [{ lengthCm: 24, widthCm: 18, heightCm: 12, grossWeightKg: 1.7 }],
    }),
  })
  assert('装箱实测', packed.status === 'pending_relabel', `status=${packed.status}`)

  const packedOms = await erp(`/outbound/oms/by-no/${encodeURIComponent(outboundNo)}`)
  const expectedVolume = 24 * 18 * 12 / 1_000_000
  assert(
    'ERP 实测字段',
    Math.abs(packedOms.measure?.totalVolumeM3 - expectedVolume) < 0.0000001 &&
      packedOms.measure?.totalWeightKg === 1.7,
    JSON.stringify(packedOms.measure),
  )
  assert('ERP 实算字段', packedOms.actualFees?.actualTotal === 42.4, JSON.stringify(packedOms.actualFees))
  step('ERP 打包实测实算', { measure: packedOms.measure, actualFees: packedOms.actualFees })

  const relabeled = await erp(`/outbound/${erpOrder.id}/confirm-relabel`, {
    method: 'POST',
    body: JSON.stringify({
      items: [{
        id: item.id,
        scannedBarcode: SKU,
        newBarcode: `NEW-${RUN_ID}`,
      }],
    }),
  })
  assert(
    '换标扫描',
    relabeled.status === 'packed' && relabeled.relabelPrintCount === 2,
    `status=${relabeled.status}, printCount=${relabeled.relabelPrintCount}`,
  )

  const shipped = await erp(`/outbound/${erpOrder.id}/ship`, {
    method: 'POST',
    body: JSON.stringify({
      trackingNo: `TRK-OUT-${RUN_ID}`,
      carrier: 'E2E Carrier',
      logisticsProduct: '卡派',
    }),
  })
  assert('ERP 发运', shipped.status === 'shipped', `status=${shipped.status}, tracking=${shipped.trackingNo}`)

  const settle = await waitFor('ERP 自动 outbound.fees webhook', async () => {
    const billing = await oms('/billing')
    return billing.feeRecords.find(row => row.id === `settle-${outboundNo}`) || null
  })
  assert('自动费用 Webhook', settle.method === 'settlement_adjust', JSON.stringify(settle))

  const billingAfterShip = await oms('/billing')
  const fees = billingAfterShip.feeRecords.filter(row => row.refNo === outboundNo)
  const actual = fees.filter(row => row.method === 'actual')
  const actualTotal = actual.reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0)
  const expectedActualGrand = 44.8
  assert('ERP 实扣流水总额', Math.abs(actualTotal - expectedActualGrand) < 0.001, `actual=${actualTotal}`)
  assert('对账差额符号', settle.amount === -2.4, `settlement_adjust=${settle.amount}`)

  const charges = await oms(`/erp/customers/${CUSTOMER_CODE}/charges?pageSize=100`)
  const outboundCharges = (charges.items || []).filter(row => row.bizRef === outboundNo || row.sourceRef === outboundNo)
  step('ERP billing_charge', outboundCharges)
  assert('ERP 费用类型完整', ['handling', 'outbound_ship', 'relabel'].every(type => outboundCharges.some(row => row.chargeType === type)), outboundCharges.map(row => row.chargeType).join(','))

  const delivered = await erp(`/outbound/${erpOrder.id}/deliver`, {
    method: 'POST',
    body: JSON.stringify({ podCode: `POD-${RUN_ID}` }),
  })
  assert('ERP 送达', delivered.status === 'delivered', `status=${delivered.status}`)
  const afterDeliver = await erp(`/outbound/oms/by-no/${encodeURIComponent(outboundNo)}`)
  if (afterDeliver.podCode !== `POD-${RUN_ID}`) {
    evidence.findings.push({
      priority: 'P0',
      category: '数据缺失',
      title: 'deliver API 忽略 podCode',
      detail: `提交 POD-${RUN_ID}，ERP 回读 podCode=${JSON.stringify(afterDeliver.podCode)}`,
    })
  }

  const podBytes = Buffer.from(
    `%PDF-1.4\n% E2E POD ${RUN_ID}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
    'utf8',
  )
  const sourceHash = createHash('sha256').update(podBytes).digest('hex')
  const podUpload = await oms(`/erp/outbound/${encodeURIComponent(outboundNo)}/pod`, {
    method: 'POST',
    body: JSON.stringify({
      customerCode: CUSTOMER_CODE,
      customerId: '1',
      fileName: `POD-E2E-${RUN_ID}.pdf`,
      contentBase64: podBytes.toString('base64'),
    }),
  })
  step('POD 上传', podUpload)

  const logistics = await waitFor('POD logistics.update webhook', async () => {
    const data = await oms(`/erp/logistics/by-customer/${CUSTOMER_CODE}`)
    return (data.items || []).find(row => row.outboundNo === outboundNo && row.podStatus === 'uploaded') || null
  })
  assert('POD 状态回传', logistics.podStatus === 'uploaded', JSON.stringify(logistics))

  const downloadRes = await fetch(
    `${OMS}/erp/outbound/${encodeURIComponent(outboundNo)}/pod?customerCode=${encodeURIComponent(CUSTOMER_CODE)}`,
  )
  const downloadBytes = Buffer.from(await downloadRes.arrayBuffer())
  const downloadedHash = createHash('sha256').update(downloadBytes).digest('hex')
  assert(
    'POD 字节完整性',
    downloadRes.ok && downloadBytes.length === podBytes.length && downloadedHash === sourceHash,
    JSON.stringify({
      http: downloadRes.status,
      contentType: downloadRes.headers.get('content-type'),
      sourceBytes: podBytes.length,
      downloadedBytes: downloadBytes.length,
      sourceHash,
      downloadedHash,
    }),
  )

  const final = await Promise.all([
    erp(`/outbound/oms/by-no/${encodeURIComponent(outboundNo)}`),
    erp(`/customers/oms/by-code/${CUSTOMER_CODE}`),
    oms('/billing'),
    oms('/bootstrap'),
  ])
  const finalErp = final[0]
  const finalErpBalance = Number(final[1].balance)
  const finalBilling = final[2]
  const finalOmsOrder = final[3].outboundOrders.find(row => row.outboundNo === outboundNo)
  evidence.values.erpBalanceAfterOutbound = finalErpBalance
  evidence.values.omsBalanceAfterSettlement = Number(finalBilling.creditBalance)
  evidence.values.preDeductTotal = 42.4
  evidence.values.actualCoreTotal = 42.4
  evidence.values.relabelTotal = 2.4
  evidence.values.actualGrandTotal = expectedActualGrand
  evidence.values.settlementAdjust = -2.4
  evidence.values.podSourceHash = sourceHash
  evidence.values.podDownloadedHash = downloadedHash
  step('主链路最终结果', {
    erp: finalErp,
    omsOrder: finalOmsOrder,
    fees: finalBilling.feeRecords.filter(row => row.refNo === outboundNo),
    logistics,
    balances: {
      erpBeforeOutbound: evidence.values.erpBalanceBeforeOutbound,
      erpAfterOutbound: finalErpBalance,
      omsAfterPreDeduct: evidence.values.omsBalanceAfterPreDeduct,
      omsAfterSettlement: finalBilling.creditBalance,
    },
    pod: {
      fileName: `POD-E2E-${RUN_ID}.pdf`,
      sourceBytes: podBytes.length,
      downloadedBytes: downloadBytes.length,
      sourceHash,
      downloadedHash,
      contentType: downloadRes.headers.get('content-type'),
    },
  })
}

async function edgePhase() {
  await login()
  const outboundNo = `OUT-E2E-${RUN_ID}-${OUTBOUND_SUFFIX === 'MAIN' ? 'CANCEL' : OUTBOUND_SUFFIX}`
  const erpOrder = await erp(`/outbound/oms/by-no/${encodeURIComponent(outboundNo)}`)
  evidence.ids.cancelOutboundId = erpOrder.id
  evidence.ids.cancelOutboundNo = outboundNo
  const [inventoryBefore, billingBefore, wmsBefore] = await Promise.all([
    oms(`/erp/customers/${CUSTOMER_CODE}/inventory-view`),
    oms('/billing'),
    erp(`/inventory?warehouseCode=WMS-JHB-01&keyword=${encodeURIComponent(SKU)}&pageSize=20`),
  ])
  const holdingBefore = (inventoryBefore.items || []).find(row => row.sku === SKU)
  const warehouseBefore = (wmsBefore.items || []).find(row => row.sku === SKU)
  step('取消前基线', {
    status: erpOrder.status,
    customerHolding: holdingBefore,
    warehouseInventory: warehouseBefore,
    omsBalance: billingBefore.creditBalance,
  })
  assert('取消单已锁定 ERP 库存', erpOrder.status === 'pending_pick', `status=${erpOrder.status}`)

  const duplicateResponse = await fetch(`${OMS}/erp/outbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      outboundNo,
      customerCode: CUSTOMER_CODE,
      warehouseCode: 'WMS-JHB-01',
      platform: 'Takealot',
      stockSource: 'catalog',
      destType: 'fba',
      fbaWarehouse: 'JHB3',
      shippingMethod: '卡派',
      destination: '冲突载荷',
      source: 'catalog_dist',
      items: [{ sku: SKU, qty: 1, productName: '冲突数量' }],
      preDeduct: {
        destRegion: 'jhb',
        priceTemplateId: 'conflict-template',
        priceTemplateName: '冲突模板',
        preDeductTotal: 999,
        lines: [{ type: 'handling', label: '冲突费用', amount: 999 }],
      },
    }),
  })
  const duplicate = await duplicateResponse.json()
  step('出库号冲突重放', { httpStatus: duplicateResponse.status, body: duplicate })
  assert(
    '出库幂等载荷冲突拦截',
    duplicateResponse.status === 409,
    `http=${duplicateResponse.status}, body=${JSON.stringify(duplicate)}`,
  )

  const cancelled = await erp(`/outbound/${erpOrder.id}/cancel`, { method: 'POST', body: '{}' })
  assert('ERP 取消出库', cancelled.status === 'cancelled', `status=${cancelled.status}`)
  const refund = await waitFor('outbound.refund webhook', async () => {
    const billing = await oms('/billing')
    return billing.feeRecords.find(row => row.id === `refund-${outboundNo}`) || null
  })
  assert('取消退还预扣', refund.amount === 42.4, JSON.stringify(refund))

  const [finalErp, finalBilling, finalBootstrap, inventoryAfter, wmsAfter] = await Promise.all([
    erp(`/outbound/oms/by-no/${encodeURIComponent(outboundNo)}`),
    oms('/billing'),
    oms('/bootstrap'),
    oms(`/erp/customers/${CUSTOMER_CODE}/inventory-view`),
    erp(`/inventory?warehouseCode=WMS-JHB-01&keyword=${encodeURIComponent(SKU)}&pageSize=20`),
  ])
  const finalOmsOrder = finalBootstrap.outboundOrders.find(row => row.outboundNo === outboundNo)
  const holdingAfter = (inventoryAfter.items || []).find(row => row.sku === SKU)
  const warehouseAfter = (wmsAfter.items || []).find(row => row.sku === SKU)
  assert(
    '取消余额回滚',
    Math.abs(Number(finalBilling.creditBalance) - (Number(billingBefore.creditBalance) + 42.4)) < 0.001,
    `${billingBefore.creditBalance} -> ${finalBilling.creditBalance}`,
  )
  assert(
    '取消仓库库存解锁',
    warehouseAfter?.lockedQty === 0 && warehouseAfter?.availableQty === warehouseBefore?.availableQty + 2,
    JSON.stringify({ before: warehouseBefore, after: warehouseAfter }),
  )
  if ((holdingAfter?.quantity || 0) !== (holdingBefore?.quantity || 0) + 2) {
    evidence.findings.push({
      priority: 'P0',
      category: '数据缺失',
      title: '货盘出库取消未归还客户持有库存',
      detail: `取消前 quantity=${holdingBefore?.quantity ?? 0}，取消后 quantity=${holdingAfter?.quantity ?? 0}，应增加 2`,
    })
  }
  if (finalOmsOrder?.status === 'exception' && finalErp.status === 'cancelled') {
    evidence.findings.push({
      priority: 'P0',
      category: '语义错误',
      title: 'ERP cancelled 被 OMS 映射为 exception',
      detail: `ERP=${finalErp.status}, OMS=${finalOmsOrder.status}`,
    })
  }

  const overNo = `OUT-E2E-${RUN_ID}-OVER`
  const overRes = await fetch(`${OMS}/erp/outbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      outboundNo: overNo,
      customerCode: CUSTOMER_CODE,
      warehouseCode: 'WMS-JHB-01',
      platform: 'Takealot',
      stockSource: 'catalog',
      destType: 'fba',
      fbaWarehouse: 'JHB3',
      shippingMethod: '卡派',
      destination: 'Takealot JHB3',
      source: 'catalog_dist',
      items: [{ sku: SKU, qty: 999, productName: PRODUCT_NAME }],
      preDeduct: {
        destRegion: 'jhb',
        priceTemplateId: 'pt-jhb-std',
        priceTemplateName: 'JHB 标准价',
        preDeductTotal: 9999,
        lines: [{ type: 'handling', label: '操作费', amount: 9999 }],
      },
    }),
  })
  const overText = await overRes.text()
  assert('库存不足拦截', overRes.status === 400, `http=${overRes.status}, body=${overText}`)

  evidence.values.cancelBalanceBefore = Number(billingBefore.creditBalance)
  evidence.values.cancelBalanceAfter = Number(finalBilling.creditBalance)
  step('边界链路最终结果', {
    duplicate: {
      httpStatus: duplicateResponse.status,
      response: duplicate,
    },
    cancel: {
      erpStatus: finalErp.status,
      omsStatus: finalOmsOrder?.status,
      settlementStatus: finalOmsOrder?.settlementStatus,
      refund,
      customerHoldingBefore: holdingBefore,
      customerHoldingAfter: holdingAfter,
      warehouseBefore,
      warehouseAfter,
      balanceBefore: billingBefore.creditBalance,
      balanceAfter: finalBilling.creditBalance,
    },
    insufficientInventory: {
      httpStatus: overRes.status,
      response: overText,
    },
  })
}

async function main() {
  if (PHASE === 'sku') await skuAndInboundPhase()
  else if (PHASE === 'sku-resume') await resumeSkuAndInboundPhase()
  else if (PHASE === 'outbound') await outboundPhase()
  else if (PHASE === 'edge') await edgePhase()
  else throw new Error(`未知 AUDIT_PHASE: ${PHASE}`)
  console.log('\n=== AUDIT EVIDENCE ===')
  console.log(JSON.stringify(evidence, null, 2))
}

main().catch(error => {
  console.error('\nAUDIT FAILED')
  console.error(error.stack || error)
  console.log('\n=== PARTIAL AUDIT EVIDENCE ===')
  console.log(JSON.stringify(evidence, null, 2))
  process.exit(1)
})
