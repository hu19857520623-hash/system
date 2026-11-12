import { buildOmsCatalogPayload } from './oms-catalog-sync.util'
import { catalogPriceTier, customerCatalogTier, validateCatalogPrices } from './catalog-price.util'
import { setCatalogPrices, setCustomerCatalogTier } from './catalog-price-settings.util'
const row = { id: 2n, sku: 'TKL-A', productName: '测试商品', finalPrice: 10, priceB: 8.25, priceC: 7.10, priceD: 6.99, visibleStockQty: 10, receivedGoodQty: 10, soldQty: 0, visibleOnOms: true, orderableOnOms: true, pricingStatus: 'synced' }
function fixture() {
  let state: any = { row: { ...row }, customer: { id: 1n, customerCode: 'C1', catalogPriceTier: 'A', balance: -5, creditLimit: 100 }, history: [], logs: [], records: [] }
  let fail = false, queue = Promise.resolve()
  const prisma: any = { $transaction: (work: any) => {
    const result = queue.then(async () => {
      const draft = structuredClone(state), tx: any = {
        $queryRaw: async () => [],
        productPricing: { findUnique: async () => draft.row, update: async ({ data }: any) => Object.assign(draft.row, data) },
        customer: { findUnique: async () => draft.customer, update: async ({ data }: any) => Object.assign(draft.customer, data) },
        productPricingHistory: { create: async ({ data }: any) => { if (fail) throw Error('audit failed'); draft.history.push(data) } },
        operationLog: { create: async ({ data }: any) => { if (fail) throw Error('audit failed'); draft.logs.push(data) } },
        productPriceRecord: { create: async ({ data }: any) => draft.records.push(data) },
      }
      const value = await work(tx); state = draft; return value
    }); queue = result.then(() => undefined, () => undefined); return result
  } }
  return { prisma, state: () => state, fail: () => { fail = true } }
}
const data = { prices: { A: 11, B: 9, C: 8, D: 7 }, expectedPrices: { A: 10, B: 8.25, C: 7.1, D: 6.99 }, remark: '四档调价' }
describe('四档货盘价格及客户绑定', () => {
  it.each([['A', 10], ['B', 8.25], ['C', 7.10], ['D', 6.99]] as const)('展示只返回 %s 档价格，不包含其他报价', (tier, price) => {
    const result = buildOmsCatalogPayload(row, tier); expect(result).toMatchObject({ price, priceTier: tier, priceConfigured: true, orderableOnOms: true })
    for (const field of ['finalPrice', 'priceB', 'priceC', 'priceD', 'prices']) expect(result).not.toHaveProperty(field)
  })
  it('缺价不可购买，绝不返回基础档报价', () => {
    expect(buildOmsCatalogPayload({ ...row, priceB: null }, 'B')).toMatchObject({ price: 0, priceConfigured: false, orderableOnOms: false })
  })
  it.each(['', null, 'E', 'a', 1])('拒绝非法档位 %p', v => expect(() => catalogPriceTier(v)).toThrow())
  it('以ERP客户绑定选择档位，无效客户不能拿默认报价', async () => {
    const db = { customer: { findUnique: jest.fn().mockResolvedValue({ status: 1, catalogPriceTier: 'C' }) } }
    expect(await customerCatalogTier(db, 'c1')).toBe('C'); expect(db.customer.findUnique).toHaveBeenCalledWith({ where: { customerCode: 'C1' } })
    db.customer.findUnique.mockResolvedValue(null); await expect(customerCatalogTier(db, 'missing')).rejects.toThrow('不存在或已停用')
    await expect(customerCatalogTier(db, '')).rejects.toThrow('缺少货盘报价客户')
  })
  it.each([0, -1, 0.001, '8', true, NaN, Infinity])('拒绝非法档价 %p', v => expect(() => validateCatalogPrices({ ...data.prices, B: v })).toThrow())
  it('可以清空BCD，不能清空A，不能提交多余或缺失档位', () => {
    expect(validateCatalogPrices({ A: 10, B: null, C: null, D: null })).toEqual({ A: 10, B: null, C: null, D: null })
    expect(() => validateCatalogPrices({ ...data.prices, A: null })).toThrow()
    expect(() => validateCatalogPrices({ A: 10, B: 8 })).toThrow()
    expect(() => validateCatalogPrices({ ...data.prices, E: 1 })).toThrow()
  })
  it('四档金额与审计同事务提交，A档价格记录保持兼容', async () => {
    const f = fixture(); await setCatalogPrices(f.prisma, 2, data, 7)
    expect(f.state().row).toMatchObject({ finalPrice: 11, priceB: 9, priceC: 8, priceD: 7 })
    expect(JSON.parse(f.state().history[0].detail)).toMatchObject({ before: data.expectedPrices, after: data.prices, remark: data.remark })
    expect(f.state().records[0]).toMatchObject({ price: 11 })
  })
  it('审计失败回滚全部四档金额', async () => {
    const f = fixture(), before = structuredClone(f.state()); f.fail()
    await expect(setCatalogPrices(f.prisma, 2, data, 7)).rejects.toThrow('audit failed'); expect(f.state()).toEqual(before)
  })
  it('并发编辑只允许原报价仍有效的一笔成功', async () => {
    const f = fixture(), results = await Promise.allSettled([setCatalogPrices(f.prisma, 2, data, 7), setCatalogPrices(f.prisma, 2, { ...data, prices: { A: 20, B: 19, C: 18, D: 17 } }, 8)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(f.state().history).toHaveLength(1)
  })
  it('客户档位切换保留余额与信用额度，记录操作人及前后档位', async () => {
    const f = fixture(); await setCustomerCatalogTier(f.prisma, 1, { tier: 'D', expectedTier: 'A' }, 7)
    expect(f.state().customer).toMatchObject({ catalogPriceTier: 'D', balance: -5, creditLimit: 100 })
    expect(f.state().logs[0]).toMatchObject({ operatorId: 7n, detail: { before: 'A', after: 'D' } })
    await expect(setCustomerCatalogTier(f.prisma, 1, { tier: 'B', expectedTier: 'A' }, 7)).rejects.toThrow('档位已变化')
  })
  it('档位审计失败回滚绑定；缺少字段不能重置成A', async () => {
    const f = fixture(); f.fail(); await expect(setCustomerCatalogTier(f.prisma, 1, { tier: 'C', expectedTier: 'A' }, 7)).rejects.toThrow('audit failed')
    expect(f.state().customer.catalogPriceTier).toBe('A'); await expect(setCustomerCatalogTier(f.prisma, 1, {}, 7)).rejects.toThrow('完整提交')
  })
})
