import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { parseTakealotProductLabelPdf } from '../src/data/takealotLabelPdf'

const OMS_BASE = process.env.OMS_E2E_BASE || 'http://127.0.0.1:3001'
const ERP_BASE = process.env.ERP_E2E_BASE || 'http://127.0.0.1:3000/api'
const PDF_DIR = process.env.TAKEALOT_PDF_DIR || 'C:/Users/15693/Desktop'
const OMS_EMAIL = String(process.env.OMS_E2E_EMAIL || '').trim()
const OMS_PASSWORD = String(process.env.OMS_E2E_PASSWORD || '')
const ERP_USERNAME = process.env.ERP_E2E_USERNAME || 'admin'
const ERP_PASSWORD = process.env.ERP_E2E_PASSWORD || '123456'

if (!OMS_EMAIL || !OMS_PASSWORD) {
  throw new Error('Set OMS_E2E_EMAIL and OMS_E2E_PASSWORD before running this verification')
}

const files = {
  deliveryList: 'shipping_note_PO_29896140_13_08_2026_CPT_1.pdf',
  outerLabel: 'shipping_labels_PO_29896140_13_08_2026_CPT_1.pdf',
  skuLabel: 'product_labels_PO_29896140_13_08_2026_CPT_1.pdf',
  appointment: 'TALBWDBYN5231740.pdf',
} as const

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(body)}`)
  }
  return body as T
}

async function assertPdf(response: Response, description: string) {
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${description} failed: ${response.status} ${body}`)
  }
  assert.match(response.headers.get('content-type') || '', /^application\/pdf\b/i)
  const content = Buffer.from(await response.arrayBuffer())
  assert.equal(content.subarray(0, 5).toString('ascii'), '%PDF-', `${description} is not a PDF`)
  return content.length
}

const omsLogin = await responseJson<{
  token: string
  user: { customerId: string; customerCode: string; mustChangePassword: boolean }
}>(await fetch(`${OMS_BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: OMS_EMAIL, password: OMS_PASSWORD, remember: false }),
}))
assert.equal(omsLogin.user.mustChangePassword, false, 'OMS test user must finish first-login password change')

const labelBytes = await readFile(`${PDF_DIR}/${files.skuLabel}`)
const labelFile = new File([labelBytes], files.skuLabel, { type: 'application/pdf' })
const parsedLabels = await parseTakealotProductLabelPdf(labelFile)
assert.equal(parsedLabels.status, 'ok')
assert.equal(parsedLabels.crops.length, 11)

const barcodes = [...new Set(parsedLabels.crops.map(crop => crop.barcode))]
assert.equal(barcodes.length, 5)
const skuByBarcode = new Map(
  barcodes.map((barcode, index) => [barcode, `E2ELBL${String(index + 1).padStart(2, '0')}`]),
)
const quantities = new Map<string, number>()
for (const crop of parsedLabels.crops) {
  const sku = skuByBarcode.get(crop.barcode)!
  quantities.set(sku, (quantities.get(sku) || 0) + 1)
}

const prisma = new PrismaClient()
try {
  const customers = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(
    'SELECT id FROM customer WHERE customer_code = ? LIMIT 1',
    omsLogin.user.customerCode,
  )
  assert.equal(customers.length, 1, 'OMS user customer does not exist in ERP')
  const customerId = customers[0].id

  for (const [barcode, sku] of skuByBarcode) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO product
        (sku, product_name, barcode, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', NOW(), NOW())
       ON DUPLICATE KEY UPDATE
        product_name = VALUES(product_name),
        barcode = VALUES(barcode),
        status = 'active',
        updated_at = NOW()`,
      sku,
      `Takealot 标签联调商品 ${sku}`,
      barcode,
    )
    const products = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(
      'SELECT id FROM product WHERE sku = ? LIMIT 1',
      sku,
    )
    assert.equal(products.length, 1)
    await prisma.$executeRawUnsafe(
      `INSERT INTO inventory
        (product_id, sku, warehouse_code, total_qty, available_qty, locked_qty, updated_at)
       VALUES (?, ?, 'WMS-JHB-01', 100, 100, 0, NOW())
       ON DUPLICATE KEY UPDATE
        total_qty = GREATEST(total_qty, 100),
        available_qty = GREATEST(available_qty, 100),
        updated_at = NOW()`,
      products[0].id,
      sku,
    )
    await prisma.$executeRawUnsafe(
      `INSERT INTO customer_sku_inventory
        (customer_id, sku, product_name, quantity, unit_price, created_at, updated_at)
       VALUES (?, ?, ?, 100, 0, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
        product_name = VALUES(product_name),
        quantity = GREATEST(quantity, 100),
        updated_at = NOW()`,
      customerId,
      sku,
      `Takealot 标签联调商品 ${sku}`,
    )
  }
} finally {
  await prisma.$disconnect()
}

const sourceAttachments = await Promise.all(
  Object.entries(files).map(async ([fileType, fileName]) => ({
    fileType,
    fileName,
    contentBase64: (await readFile(`${PDF_DIR}/${fileName}`)).toString('base64'),
    labelRole: 'sourceDocument',
  })),
)
const unitAttachments = parsedLabels.crops.map(crop => ({
  fileType: 'skuLabel',
  fileName: crop.fileName,
  contentBase64: crop.dataUrl.slice(crop.dataUrl.indexOf(',') + 1),
  sku: skuByBarcode.get(crop.barcode),
  platformBarcode: crop.barcode,
  unitIndex: crop.unitIndex,
  sourcePage: crop.page,
  sourceRow: crop.row + 1,
  sourceColumn: crop.column + 1,
  labelRole: 'unitCrop',
}))
const items = [...quantities].map(([sku, qty]) => ({
  sku,
  qty,
  productName: `Takealot 标签联调商品 ${sku}`,
}))
const outboundNo = `E2ELBL-${Date.now().toString().slice(-10)}`
const order = await responseJson<{
  id: number
  erpId?: number
  outboundNo: string
  attachments: Array<{
    sku?: string | null
    platformBarcode?: string | null
    unitIndex?: number | null
    labelRole?: string | null
  }>
}>(await fetch(`${OMS_BASE}/api/erp/outbound`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${omsLogin.token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    outboundNo,
    customerCode: omsLogin.user.customerCode,
    warehouseCode: 'WMS-JHB-01',
    platform: 'Takealot',
    fbaNo: '184505024',
    appointmentDate: '2026-08-20',
    shipmentDueDate: '2026-08-19',
    sellerStoreName: 'Takealot Label E2E',
    takealotSellerId: '29896140',
    takealotBookingRef: 'TALBWDBYN5231740',
    stockSource: 'catalog',
    destType: 'fba',
    fbaWarehouse: 'CPT',
    shippingMethod: '卡派',
    destination: 'Takealot CPT 仓',
    source: 'platform_order',
    items,
    attachments: [...sourceAttachments, ...unitAttachments],
  }),
}))

assert.equal(order.outboundNo, outboundNo)
assert.equal(order.attachments.filter(item => item.labelRole === 'unitCrop').length, 11)
assert.ok(order.attachments
  .filter(item => item.labelRole === 'unitCrop')
  .every(item => item.sku && item.platformBarcode && item.unitIndex))

const erpLoginResponse = await responseJson<{
  data: { token: string }
}>(await fetch(`${ERP_BASE}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: ERP_USERNAME, password: ERP_PASSWORD }),
}))
const erpHeaders = { authorization: `Bearer ${erpLoginResponse.data.token}` }
const erpId = order.erpId || order.id
const firstSku = items[0].sku
const unitBytes = await assertPdf(
  await fetch(`${ERP_BASE}/outbound/${erpId}/labels/sku/${encodeURIComponent(firstSku)}/unit/1`, {
    headers: erpHeaders,
  }),
  'unit label download',
)
const skuBytes = await assertPdf(
  await fetch(`${ERP_BASE}/outbound/${erpId}/labels/sku/${encodeURIComponent(firstSku)}`, {
    headers: erpHeaders,
  }),
  'SKU label download',
)
const orderBytes = await assertPdf(
  await fetch(`${ERP_BASE}/outbound/${erpId}/labels`, { headers: erpHeaders }),
  'order label download',
)

console.log(JSON.stringify({
  outboundNo,
  erpId,
  customerCode: omsLogin.user.customerCode,
  barcodes: barcodes.length,
  unitCrops: unitAttachments.length,
  storedAttachments: order.attachments.length,
  printBytes: { unit: unitBytes, sku: skuBytes, order: orderBytes },
}))
