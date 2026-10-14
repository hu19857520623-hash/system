// Local browser regression only: every API request is mocked; no orders are submitted.
const { chromium } = require(process.env.TFS_PLAYWRIGHT_PATH || 'playwright')
const assert = require('node:assert/strict')
const path = require('node:path')
const root = process.env.TFS_PDF_ROOT || process.argv[2]
if (!root) throw new Error('Set TFS_PDF_ROOT or provide the PDF directory as the first argument')
const files = ['shipping_note_990_JM_543_DBN.pdf', 'shipping_labels_990_JM_543_DBN(1).pdf', 'product_labels_990_JM_543_DBN.pdf', 'Stickers_25_GLJJTT(2).pdf'].map(name => path.join(root, name))
const user = { id: 'test', username: 'test', email: 'test@example.test', name: 'TFS test', role: 'ecommerce', customerId: 'test-customer', customerCode: 'TEST01', status: 'active', type: 'ecommerce', warehouse: 'jhb', mustChangePassword: false, permissions: ['outbound:read', 'outbound:write', 'platform:read', 'platform:write', 'product:read', 'inventory:read'] }
const skus = ['710672', '710695-2', '710515-2']
const barcodes = ['9900000000001', '9900000000002', '9900000000003']
const products = skus.map((sku, i) => ({ id: String(i), customerId: user.customerId, internalSku: `TEST01-${sku}`, customerSku: sku, name: `TFS product ${sku}`, spec: '', image: '', price: 20, cost: 10, availableQty: 20, lockedQty: 0, category: '', categoryPath: '', weight: '1kg', weightKg: 1, lengthCm: 20, widthCm: 20, heightCm: 20, inCatalog: false, productStatus: 'available', hasBattery: false, certUploaded: false, hasBoxSpec: false, declaredNameEn: 'test', declaredNameCn: 'test', declaredValue: 20, unit: 'pcs' }))
const bootstrap = { accounts: [{ id: user.customerId, code: 'TEST01', name: 'Test', status: 'active', type: 'ecommerce' }], billing: { creditBalance: 10000 }, products, inventory: [], purchases: [], orders: [], inboundOrders: [], returnOrders: [], outboundOrders: [], stores: [], logistics: [], systemMessages: [], announcements: [], feeRecords: [], paymentMethods: [], fulfillmentWarehouses: [{ id: 'jhb3', city: 'Johannesburg' }, { id: 'dbn', city: 'Durban' }], feeTemplates: { priceTemplates: [], storageTemplate: null, regionDispatchRules: [] }, platformSkuMappings: products.map((p, i) => ({ id: `mapping-${i}`, customerId: user.customerId, sellerId: '29889711', platform: 'Takealot', storeId: 'test-store', storeName: 'test', platformBarcode: barcodes[i], lines: [{ internalSku: p.internalSku, qty: 1 }], status: 'active', stockSource: 'owned', version: 1, hasInventory: true, updatedAt: '2026-10-13' })) }
bootstrap.accounts[0].permissions = user.permissions
;(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.TFS_BROWSER_CHANNEL || 'msedge' })
  try {
    for (const mode of ['batch', 'sequential']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
      await context.addInitScript(session => localStorage.setItem('oms-auth-session', JSON.stringify(session)), { token: 'mock-token', user })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      const bindingWrites = []
      let drafts = []
      await page.route(url => url.pathname.startsWith('/api/'), route => {
        const url = new URL(route.request().url())
        if (url.pathname === '/api/platform-sku-mappings' && route.request().method() === 'PUT') bindingWrites.push(route.request().postDataJSON())
        if (url.pathname === '/api/outbound-orders' && route.request().method() === 'PUT') drafts = route.request().postDataJSON()
        return route.fulfill({ json: url.pathname === '/api/auth/me' ? { user } : url.pathname === '/api/bootstrap' ? { ...bootstrap, outboundOrders: drafts } : { ok: true } })
      })
      await page.goto(process.env.TFS_TEST_URL || 'http://127.0.0.1:5191/outbound')
      try { await page.getByLabel('出库类型').waitFor({ timeout: 10000 }) }
      catch (error) {
        console.log('failed page', page.url(), await page.locator('body').innerText(), errors)
        await page.screenshot({ path: 'output/tfs-analysis/tfs-upload-failed.png', fullPage: true })
        throw error
      }
      if (mode === 'batch') {
        await page.getByLabel('出库类型').selectOption('TFS快递')
        await page.locator('input[type=file][multiple]').setInputFiles(files)
      } else {
        // Starting from Takealot also switches to TFS when its courier label arrives first.
        for (const file of [files[3], files[0], files[2], files[1]]) {
          await page.locator('input[type=file][multiple]').setInputFiles(file)
          await page.getByRole('button', { name: '正在读取并识别文件…' }).waitFor({ state: 'hidden' })
        }
      }
      await page.getByLabel('TFS 快递参考号').waitFor()
      await page.waitForFunction(() => document.querySelector('input[readonly][type=number]')?.value === '3')
      assert.equal(await page.getByLabel('出库类型').inputValue(), 'TFS快递')
      assert.equal(await page.getByLabel('TFS 快递参考号').inputValue(), 'GLJJTT')
      assert.equal(await page.getByLabel('包裹数').inputValue(), '3')
      assert.equal(await page.getByLabel('最早送达日期').inputValue(), '2026-10-09')
      assert.equal(await page.getByLabel('收件人姓名').inputValue(), 'TCS Admin')
      assert.equal(await page.getByLabel('城市').inputValue(), 'Durban')
      assert.equal(await page.getByLabel('邮编').inputValue(), '4019')
      assert.equal(await page.getByLabel('发货地区').inputValue(), 'rd-dbn')
      assert.equal(await page.getByLabel('订单件数').inputValue(), '3')
      assert.ok(!(await page.locator('body').innerText()).includes('缺少 13 张'))
      assert.equal(bindingWrites.length, 0, 'Own alternate labels must never write permanent bindings')
      await page.getByRole('button', { name: '保存草稿', exact: true }).click()
      await page.waitForURL('**/outbound/records')
      assert.equal(drafts.length, 1)
      assert.equal(drafts[0].lineItems.flatMap(line => line.shipmentBarcodeBindings || []).length, 3)
      await page.goto((process.env.TFS_TEST_URL || 'http://127.0.0.1:5191/outbound') + '?edit=' + drafts[0].id)
      await page.waitForFunction(() => document.querySelector('input[readonly][type=number]')?.value === '3')
      await page.getByRole('button', { name: '正在读取并识别文件…' }).waitFor({ state: 'hidden' })
      assert.ok(!(await page.locator('body').innerText()).includes('未绑定'), 'Draft must restore per-shipment SKU resolution')
      assert.equal(bindingWrites.length, 0)
      assert.deepEqual(errors, [])
      await page.screenshot({ path: `output/tfs-analysis/tfs-upload-${mode}.png`, fullPage: true })
      console.log(`TFS ${mode} upload passed: 3 SKUs, 3 units, 3 label templates, 3 parcels`)
      await context.close()
    }
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
