const { chromium } = require(process.env.TFS_PLAYWRIGHT_PATH || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const item = { sku: 'FUR-KIT-SID-004', customerCode: 'TKL', customerSku: 'FUR-KIT-SID-004', productName: 'Regression Kitchen Sideboard', imageUrl: '', spec: '', price: 100, lengthCm: 10, widthCm: 20, heightCm: 30, weightKg: 2, dimensionsSource: 'master', catalogStockPool: 20, soldQty: 5, remainingStockQty: 15, visibleOnOms: true, orderableOnOms: true, shareStatus: 'enabled', syncedAt: '2026-10-13' }
;(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  try {
    for (const role of ['sys_admin', 'catalog']) {
      const context = await browser.newContext()
      const user = { id: 'sync-test', username: 'sync-test', email: 'test@example.test', name: 'Sync Test', role, customerId: role === 'catalog' ? 'test' : null, customerCode: role === 'catalog' ? 'TEST01' : '', status: 'active', type: role === 'catalog' ? 'catalog' : null, warehouse: 'jhb', mustChangePassword: false, permissions: ['dashboard:read', 'catalog:read', 'catalog:write', 'inventory:read', 'billing:read', 'platform:read', 'platform:write'] }
      const bootstrap = { accounts: [{ id: 'test', code: 'TEST01', name: 'Test', type: 'catalog', status: 'active', permissions: user.permissions }], billing: { creditBalance: 100, monthlySpent: 0, pendingBill: 0, budgetUsed: 0 }, products: [], inventory: [], purchases: [], orders: [], inboundOrders: [], returnOrders: [], outboundOrders: [], stores: [], logistics: [], systemMessages: [], announcements: [], feeRecords: [], paymentMethods: [], platformSkuMappings: [], fulfillmentWarehouses: [], feeTemplates: { priceTemplates: [], storageTemplate: null, regionDispatchRules: [] } }
      await context.addInitScript(session => localStorage.setItem('oms-auth-session', JSON.stringify(session)), { token: 'mock-sync', user })
      const page = await context.newPage(); let reads = 0; let writes = 0; let checkingSync = false; const errors = []
      page.on('pageerror', e => errors.push(e.message))
      await page.route(url => url.pathname.startsWith('/api/'), route => {
        const request = route.request(); const pathname = new URL(request.url()).pathname
        if (pathname === '/api/inventory-state' && request.method() === 'PUT') {
          if (!checkingSync) return route.fulfill({ json: { ok: true } })
          writes++; return route.fulfill({ status: 400, json: { error: '重复 SKU：FUR-KIT-SID-004（全局不可重复）' } })
        }
        let data = {}
        if (pathname === '/api/auth/me') data = { user }
        if (pathname === '/api/bootstrap') data = bootstrap
        if (pathname === '/api/erp/catalog') { reads++; data = { items: [item], total: 1, syncedAt: item.syncedAt } }
        if (pathname.endsWith('/balance')) data = { balance: 100, customerCode: 'TEST01', status: 'active' }
        return route.fulfill({ json: data })
      })
      await page.goto(process.env.CATALOG_SYNC_URL || 'https://www.oms.sztekeluo.com/catalog')
      await page.getByText('Regression Kitchen Sideboard', { exact: true }).waitFor()
      await page.waitForLoadState('networkidle')
      checkingSync = true
      for (let i = 0; i < 2; i++) {
        await page.getByRole('button', { name: '同步 ERP' }).click()
        await page.getByText('已从 ERP 同步货盘 1 个 SKU', { exact: false }).waitFor()
      }
      assert.ok(reads >= 3)
      assert.equal(writes, 0)
      assert.deepEqual(errors, [])
      assert.ok(!(await page.locator('body').innerText()).includes('货盘目录缓存保存失败'))
      fs.mkdirSync('output/catalog-sync', { recursive: true })
      await page.screenshot({ path: `output/catalog-sync/${role}.png`, fullPage: true })
      console.log(`${role}: ERP sync passed, no inventory snapshot writes`)
      await context.close()
    }
  } finally { await browser.close() }
})().catch(e => { console.error(e); process.exitCode = 1 })
