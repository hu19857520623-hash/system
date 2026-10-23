import 'reflect-metadata'
import { OmsPurchaseService } from './oms-purchase.service'

function fixture() {
  let state: any = { customers: [{ id: 1n, customerCode: 'TKL9001', status: 1, balance: '50.00' }, { id: 2n, customerCode: 'TKL9002', status: 1, balance: '50.00' }],
    prices: [{ id: 1n, sku: 'TKL-A', productName: '货盘A', finalPrice: '10.00' }, { id: 2n, sku: 'TKL-B', productName: '货盘B', finalPrice: '15.00' }].map(p => ({ ...p, visibleStockQty: 10, soldQty: 0, visibleOnOms: true, orderableOnOms: true, pricingStatus: 'synced', shareStatus: 'enabled' })),
    orders: [], charges: [], holdings: [], histories: [], sync: [] }
  let fail = '', queue = Promise.resolve()
  const db = (get: () => any): any => ({
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRawUnsafe: async (_sql: string, id: bigint) => { get().charges.find((c: any) => c.id === id).status = 'confirmed';return 1 },
    customer: { findUnique: async ({ where }: any) => get().customers.find((c: any) => where.id ? c.id === where.id : c.customerCode === where.customerCode) || null,
      updateMany: async ({ where, data }: any) => { const c = get().customers.find((c: any) => c.id === where.id);if (Number(c.balance) < Number(where.balance.gte)) return { count: 0 };c.balance = (Number(c.balance) - Number(data.balance.decrement)).toFixed(2);return { count: 1 } } },
    productPricing: { findUnique: async ({ where }: any) => get().prices.find((p: any) => where.id ? p.id === where.id : p.sku === where.sku) || null,
      findFirst: jest.fn(async ({ where }: any) => get().prices.find((p: any) => where.sku.in.includes(p.sku)) || null),
      update: async ({ where, data }: any) => { const p = get().prices.find((p: any) => p.id === where.id);p.soldQty += data.soldQty.increment;if (data.orderableOnOms === false) p.orderableOnOms = false;return p } },
    omsCatalogOrder: { findUnique: async ({ where }: any) => get().orders.find((o: any) => o.orderNo === where.orderNo) || null,
      create: async ({ data }: any) => { const row = { id: BigInt(get().orders.length + 1), createdAt: new Date('2026-10-23T00:00:00Z'), ...data };get().orders.push(row);return row } },
    customerSkuInventory: { findUnique: async ({ where }: any) => get().holdings.find((h: any) => h.customerId === where.customerId_sku.customerId && h.sku === where.customerId_sku.sku) || null,
      upsert: async ({ where, create, update }: any) => { const old = get().holdings.find((h: any) => h.customerId === where.customerId_sku.customerId && h.sku === where.customerId_sku.sku);if (old) old.quantity += update.quantity.increment;else get().holdings.push({ id: BigInt(get().holdings.length + 1), ...create }) } },
    productPricingHistory: { create: async ({ data }: any) => { if (fail === 'history') throw Error('定价历史末尾失败');get().histories.push(data) } },
    syncLog: { create: async ({ data }: any) => { if ((fail === 'receipt' && data.syncType === 'oms_catalog_purchase') || (fail === 'catalog-sync' && data.syncType === 'oms_catalog_stock')) throw Error('同步凭据失败');get().sync.push(data) } },
    product: { findFirst: async () => null },
  })
  const prisma = db(() => state)
  prisma.$transaction = (work: any) => { const result = queue.then(async () => { const draft = structuredClone(state), tx = db(() => draft);tx._state = draft;const result = await work(tx);state = draft;return result });queue = result.then(() => undefined, () => undefined);return result }
  const billing: any = { createCharge: jest.fn(async (data: any, tx: any) => { if (fail === 'charge') throw Error('费用写入失败');const charge = { id: BigInt(tx._state.charges.length + 1), ...data, status: 'pending' };tx._state.charges.push(charge);return { id: Number(charge.id), chargeNo: 'CHG-'+charge.id } }), pushCustomerBillingToOms: jest.fn().mockResolvedValue(true) }
  const service = new OmsPurchaseService(prisma, billing), body = { orderNo: 'CAT-TEST-1', customerCode: 'TKL9001', sku: 'A', quantity: 1, unitPrice: 10 }
  const core = () => structuredClone({ customers: state.customers, prices: state.prices, orders: state.orders, charges: state.charges, holdings: state.holdings, histories: state.histories, receipts: state.sync.filter((s: any) => s.syncType === 'oms_catalog_purchase') })
  return { service, prisma, billing, body, state: () => state, core, fail: (value: string) => { fail = value } }
}

describe('货盘采购的事务、价格与原请求恢复', () => {
  it('扣款、持有、已售、费用及凭据一起提交，优先使用已发布TKL行', async () => {
    const f = fixture();f.state().prices.unshift({ ...f.state().prices[0], id: 3n, sku: 'A', visibleOnOms: false, finalPrice: 1 })
    expect(await f.service.recordPurchase(f.body)).toMatchObject({ sku: 'TKL-A', totalAmount: 10, balanceAfter: 40, currentBalance: 40, holdingQuantity: 1, remainingStockQty: 9, syncPending: false })
    expect(f.state().customers[0].balance).toBe('40.00');expect(f.state().charges).toHaveLength(1);expect(f.state().charges[0]).toMatchObject({ source: 'oms', status: 'confirmed', amount: 10 });expect(f.state().prices[1].soldQty).toBe(1)
  })
  it('两个不同SKU并发下单都扣款，不覆盖余额', async () => {
    const f = fixture();await Promise.all([f.service.recordPurchase(f.body), f.service.recordPurchase({ ...f.body, orderNo: 'CAT-TEST-2', sku: 'B', unitPrice: 15 })])
    expect(f.state().customers[0].balance).toBe('25.00');expect(f.state().holdings.map((h: any) => h.quantity)).toEqual([1, 1]);expect(f.state().charges).toHaveLength(2)
  })
  it('两个客户争抢最后一件只成交一次，不超卖', async () => {
    const f = fixture();f.state().prices[0].visibleStockQty = 1
    const results = await Promise.allSettled([f.service.recordPurchase(f.body), f.service.recordPurchase({ ...f.body, orderNo: 'CAT-TEST-2', customerCode: 'TKL9002' })])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);expect(f.state().prices[0].soldQty).toBe(1);expect(f.state().orders).toHaveLength(1);expect(f.state().customers.map((c: any) => c.balance)).toEqual(['40.00', '50.00'])
  })
  it('同一原采购并发只增加一次持有与费用', async () => {
    const f = fixture();const results = await Promise.all([f.service.recordPurchase(f.body), f.service.recordPurchase(f.body)])
    expect(results.filter(r => r.idempotent)).toHaveLength(1);expect(f.state().customers[0].balance).toBe('40.00');expect(f.state().charges).toHaveLength(1);expect(f.state().holdings[0].quantity).toBe(1)
  })
  it.each(['charge', 'history', 'receipt'])('%s末尾失败时整个采购回滚', async phase => {
    const f = fixture(), before = f.core();f.fail(phase);await expect(f.service.recordPurchase(f.body)).rejects.toThrow('失败');expect(f.core()).toEqual(before)
  })
  it('重放不能冒用其它客户、修改商品/数量/报价', async () => {
    const f = fixture();await f.service.recordPurchase(f.body);const before = f.core()
    for (const patch of [{ customerCode: 'TKL9002' }, { sku: 'B' }, { quantity: 2 }, { unitPrice: 1 }]) await expect(f.service.recordPurchase({ ...f.body, ...patch })).rejects.toThrow('原采购单号')
    expect(f.core()).toEqual(before)
  })
  it('客户不能低价购买；报价变化时先重新核对', async () => {
    const f = fixture(), before = f.core();await expect(f.service.recordPurchase({ ...f.body, unitPrice: 1 })).rejects.toThrow('报价已变化');expect(f.core()).toEqual(before)
  })
  it('未携报价的旧客户端仍按服务端价格收费', async () => {
    const f = fixture();expect(await f.service.recordPurchase({ ...f.body, unitPrice: undefined })).toMatchObject({ unitPrice: 10, totalAmount: 10 })
  })
  it('余额不足、停售或无库存时不扣款、不留下采购记录', async () => {
    const f = fixture();f.state().customers[0].balance = '1.00';let before = f.core();await expect(f.service.recordPurchase(f.body)).rejects.toThrow('余额不足');expect(f.core()).toEqual(before)
    f.state().customers[0].balance = '50.00';f.state().prices[0].shareStatus = 'stopped';before = f.core();await expect(f.service.recordPurchase(f.body)).rejects.toThrow('停止申购');expect(f.core()).toEqual(before)
    f.state().prices[0].shareStatus = 'enabled';f.state().prices[0].visibleStockQty = 0;before = f.core();await expect(f.service.recordPurchase(f.body)).rejects.toThrow('货盘剩余');expect(f.core()).toEqual(before)
  })
  it('旧采购重试返回当前余额和持有，不能覆盖为原历史余额或重复累加', async () => {
    const f = fixture();await f.service.recordPurchase(f.body);await f.service.recordPurchase({ ...f.body, orderNo: 'CAT-TEST-2' })
    f.state().customers[0].balance = '22.00';f.state().prices[0].finalPrice = '20.00';f.state().prices[0].orderableOnOms = false;const before = f.core()
    expect(await f.service.recordPurchase(f.body)).toMatchObject({ idempotent: true, unitPrice: 10, balanceAfter: 40, currentBalance: 22, holdingQuantity: 2 });expect(f.core()).toEqual(before)
  })
  it.each(['catalog-sync', 'billing-sync'])('%s失败保留已保存采购，原单号重试只恢复同步', async phase => {
    const f = fixture();if (phase === 'catalog-sync') f.fail('catalog-sync');else f.billing.pushCustomerBillingToOms.mockResolvedValueOnce(false)
    expect(await f.service.recordPurchase(f.body)).toMatchObject({ syncPending: true, currentBalance: 40 });const before = f.core();f.fail('')
    expect(await f.service.recordPurchase(f.body)).toMatchObject({ syncPending: false, idempotent: true });expect(f.core()).toEqual(before)
  })
  it('历史持有已归还且记录不存在时，重试只返回当前零持有，不重建零记录', async () => {
    const f = fixture();await f.service.recordPurchase(f.body);f.state().holdings = [];const before = f.core()
    expect(await f.service.recordPurchase(f.body)).toMatchObject({ holdingQuantity: 0, idempotent: true });expect(f.core()).toEqual(before)
  })
  it.each([0, -1, 1.5, true, '2', Infinity])('拒绝无效采购数量%s', async quantity => {
    const f = fixture();await expect(f.service.recordPurchase({ ...f.body, quantity: quantity as any })).rejects.toThrow('正整数');expect(f.state().orders).toHaveLength(0)
  })
})
