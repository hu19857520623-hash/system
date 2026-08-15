/**
 * 调用 OMS 前端实际 store/计费/提交函数创建审计出库单。
 * 运行：AUDIT_RUN_ID=... npx tsx scripts/audit-ui-outbound.ts
 */
import { hydrateAccounts } from '../src/auth/accountStore'
import { hydrateBilling, getCreditBalance, getFeeRecords, preDeductOutboundFees } from '../src/data/billingStore'
import { hydrateFeeTemplates, getPriceTemplateForCustomer, getRegionDispatchRules } from '../src/data/feeTemplateStore'
import {
  hydrateInventory,
  mergeErpCatalogIntoState,
  lockStockForOutbound,
  getInventorySnapshot,
  getProductsSnapshot,
  refreshInventoryFromErp,
} from '../src/data/inventoryStore'
import { calculateOutboundPreDeduct } from '../src/data/feeTemplates'
import {
  hydrateOutbound,
  addOutboundOrder,
  getOutboundOrders,
  submitOutboundToErp,
} from '../src/data/outboundStore'
import type { OutboundOrder } from '../src/data/mockData'

const runId = process.env.AUDIT_RUN_ID || '20260811-1732'
const sku = process.env.AUDIT_SKU || `E2E-${runId}`
const suffix = process.env.AUDIT_OUTBOUND_SUFFIX || 'MAIN'
const outboundNo = `OUT-E2E-${runId}-${suffix}`
const dropship = process.env.AUDIT_DROPSHIP === '1'
const omsOrigin = process.env.OMS_ORIGIN || 'http://127.0.0.1:3001'
const nativeFetch = globalThis.fetch.bind(globalThis)

globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  if (typeof input === 'string' && input.startsWith('/api')) {
    return nativeFetch(`${omsOrigin}${input}`, init)
  }
  return nativeFetch(input, init)
}) as typeof fetch

function requireOk(name: string, condition: unknown, detail: unknown) {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(detail)}`)
  if (!condition) throw new Error(`${name}: ${JSON.stringify(detail)}`)
}

async function wait(ms = 800) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${omsOrigin}${path}`)
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

async function main() {
  const bootstrap = await getJson<any>('/api/bootstrap')
  const catalog = await getJson<any>('/api/erp/catalog')

  hydrateAccounts(bootstrap.accounts)
  hydrateBilling({ creditBalance: bootstrap.billing.creditBalance, feeRecords: bootstrap.feeRecords })
  hydrateFeeTemplates(bootstrap.feeTemplates)
  hydrateInventory({
    inventory: bootstrap.inventory,
    products: bootstrap.products,
    purchases: bootstrap.purchases,
    accounts: bootstrap.accounts,
  })
  hydrateOutbound(bootstrap.outboundOrders)
  mergeErpCatalogIntoState(catalog.items || [])
  if (process.env.AUDIT_CHECK_ONLY === 'balance') {
    const before = getCreditBalance()
    const result = await preDeductOutboundFees(`OUT-E2E-${runId}-BALANCE`, [{
      type: 'handling',
      label: '余额不足测试',
      amount: before + 1,
      detail: `余额 ${before}，尝试预扣 ${before + 1}`,
    }])
    requireOk('OMS 余额不足拦截', !result.ok && getCreditBalance() === before, { before, result })
    return
  }
  await refreshInventoryFromErp('1', 'TKL0001')
  await wait()

  const customerInventoryBefore = getInventorySnapshot().find(
    row => row.sku === sku && row.stockSource === 'catalog' && row.customerId === '1',
  )
  requireOk('OMS 客户持有货盘库存', (customerInventoryBefore?.locked || 0) >= 2, customerInventoryBefore)
  if (suffix === 'MAIN' && customerInventoryBefore?.locked !== 4) {
    console.log(`FINDING 申购幂等漂移: ERP 持有 4 件，OMS 镜像 ${customerInventoryBefore?.locked} 件`)
  }

  const stockLines = [{ sku, qty: 2 }]
  const stockLock = await lockStockForOutbound(stockLines, 'catalog', '1')
  requireOk('OMS 前端库存锁定', stockLock.ok, stockLock)
  await wait()

  const product = getProductsSnapshot().find(row => row.internalSku === sku)
  const template = getPriceTemplateForCustomer('1', 'jhb')
  const fee = calculateOutboundPreDeduct(
    stockLines,
    '卡派',
    'jhb',
    code => {
      const row = getProductsSnapshot().find(item => item.internalSku === code)
      return row
        ? { lengthCm: row.lengthCm, widthCm: row.widthCm, heightCm: row.heightCm, weightKg: row.weightKg }
        : undefined
    },
    template,
    getRegionDispatchRules(),
  )
  const balanceBefore = getCreditBalance()
  const deducted = await preDeductOutboundFees(outboundNo, fee.lines, 'TKL0001')
  requireOk('OMS 前端预扣', deducted.ok, { balanceBefore, fee })
  await wait()

  const order: OutboundOrder = {
    id: `audit-${runId}-${suffix.toLowerCase()}`,
    customerId: '1',
    outboundNo,
    source: 'catalog_dist',
    stockSource: 'catalog',
    refNo: dropship ? `DROP-E2E-${runId}` : `FBA-E2E-${runId}`,
    type: dropship ? 'dropship' : 'takealot',
    warehouse: 'jhb1',
    items: 1,
    totalQty: 2,
    status: 'locked',
    destination: dropship ? '1 Audit Street, Johannesburg, Gauteng, 2000' : 'Takealot JHB3',
    recipient: dropship ? {
      name: 'P1 Audit Recipient',
      province: 'Gauteng',
      city: 'Johannesburg',
      postalCode: '2000',
      phone: '+27-82-000-0001',
      address1: '1 Audit Street',
      address2: 'Unit P1',
      email: 'p1-audit@example.test',
    } : undefined,
    createdAt: new Date().toISOString().slice(0, 10),
    shippingMethod: '卡派',
    preDeductFees: fee.lines,
    destRegion: 'jhb',
    priceTemplateId: template.id,
    priceTemplateName: template.name,
    preDeductTotal: fee.total,
    preDeductVolumeM3: fee.totalVolumeM3,
    preDeductWeightKg: fee.totalWeightKg,
    settlementStatus: 'pending',
    scheduledDeliveryDate: '2026-08-18 10:30',
    sellerStoreName: `E2E Store ${runId}`,
    takealotDestWarehouse: dropship ? undefined : 'jhb3',
    takealotSellerId: dropship ? undefined : `SELLER-${runId}`,
    takealotBookingRef: dropship ? undefined : `BOOK-${runId}`,
    shipmentDueDate: '2026-08-18',
    remark: `[E2E run=${runId}] OMS 前端真实 store 提交`,
    lineItems: [{
      sku,
      name: product?.name || sku,
      qty: 2,
      declaredName: 'E2E audit product',
      declaredValue: 49.9,
      note: `run=${runId}`,
    }],
  }

  addOutboundOrder(order)
  await wait()
  const erpResult = await submitOutboundToErp(order)
  requireOk('OMS 前端 submitOutboundToErp', erpResult.ok, erpResult)
  await wait(1500)

  const billing = await getJson<any>('/api/billing')
  const serverBootstrap = await getJson<any>('/api/bootstrap')
  const serverOrder = serverBootstrap.outboundOrders.find((row: any) => row.outboundNo === outboundNo)
  const preRecords = billing.feeRecords.filter((row: any) => row.refNo === outboundNo && row.method === 'pre_deduct')
  const localOrder = getOutboundOrders().find(row => row.outboundNo === outboundNo)
  const customerInventoryAfter = getInventorySnapshot().find(
    row => row.sku === sku && row.stockSource === 'catalog' && row.customerId === '1',
  )

  requireOk('OMS 出库镜像持久化', Boolean(serverOrder), serverOrder)
  if (dropship) {
    requireOk(
      '一件代发收件人双端持久化',
      serverOrder?.recipient?.name === 'P1 Audit Recipient' &&
        erpResult.ok &&
        erpResult.order.recipient?.phone === '+27-82-000-0001',
      { oms: serverOrder?.recipient, erp: erpResult.ok ? erpResult.order.recipient : null },
    )
  }
  requireOk('预扣流水持久化', preRecords.length === fee.lines.length, preRecords)
  requireOk('预扣余额数学一致', Math.abs(billing.creditBalance - (balanceBefore - fee.total)) < 0.001, {
    balanceBefore,
    balanceAfter: billing.creditBalance,
    feeTotal: fee.total,
  })

  console.log('\n=== OMS UI PATH EVIDENCE ===')
  console.log(JSON.stringify({
    runId,
    sku,
    outboundNo,
    product,
    template: {
      id: template.id,
      name: template.name,
      regionCode: template.regionCode,
      handling: template.handling,
      shipping: template.shippingByRegion.jhb?.['卡派'],
    },
    fee,
    balanceBefore,
    balanceAfter: billing.creditBalance,
    preRecords,
    customerInventoryBefore,
    customerInventoryAfter,
    localOrder,
    serverOrder,
    erpOrder: erpResult.ok ? erpResult.order : null,
  }, null, 2))
}

main().catch(error => {
  console.error(error.stack || error)
  process.exit(1)
})
