import { InboundFeeService } from './inbound-fee.service'

function fixture() {
  const items = [{ id: 1n, sku: 'A' }, { id: 2n, sku: 'B' }, { id: 3n, sku: 'A' }]
  const logs: any[] = [{ action: 'measure_inbound', detail: { request: { measureItems: [{ id: 1 }] } } }]
  const charges: any[] = []
  const order = { inboundNo: 'RV-MEASURE', omsCustomerCode: 'TKL9001', warehouseCode: 'WMS-JHB-01' }
  const rule = { id: 1n, customerId: 260n, warehouseCode: order.warehouseCode, qcUnitPrice: 0, measureUnitPrice: 0.5, labelUnitPrice: 0, putawayUnitPrice: 0, enabled: true, effectiveFrom: null, effectiveTo: null }
  const tx = { $queryRaw: jest.fn().mockResolvedValue([]), inboundOrder: { findUnique: jest.fn(async () => ({ ...order, items })) }, operationLog: { findMany: jest.fn(async () => logs) }, billingCharge: { findMany: jest.fn(async () => charges) }, inboundFeeRule: { findMany: jest.fn(async () => [rule]) } }
  const db = { customer: { findUnique: jest.fn().mockResolvedValue({ id: 260n }) }, $transaction: jest.fn(async run => run(tx)) }
  const billing = { createCharge: jest.fn(async (body: any, client: any, background: boolean) => { expect(client).toBe(tx);expect(background).toBe(false); charges.push({ ...body, status: 'pending' });return { ok: true } }), pushCustomerBillingToOms: jest.fn().mockResolvedValue(true) }
  return { service: new InboundFeeService(db as any, billing as any), order, tx, logs, charges, billing }
}
describe('分次测量SKU的累计计费', () => {
  it('先测A再测B各收一次，重测A或重放原操作均不重复收取', async () => {
    const f = fixture();await f.service.recordMeasuredSkus(f.order)
    f.logs.push({ action: 'measure_inbound', detail: { request: { measureItems: [{ id: 2 }] } } });await f.service.recordMeasuredSkus(f.order)
    f.logs.push({ action: 'measure_inbound', detail: { request: { measureItems: [{ id: 1 }] } } });await f.service.recordMeasuredSkus(f.order);await f.service.recordMeasuredSkus(f.order)
    expect(f.charges.map(row => row.amount)).toEqual([0.5, 0.5]);expect(f.charges.map(row => row.idempotencyKey)).toEqual(['inbound:RV-MEASURE:inbound_measure:skus:1','inbound:RV-MEASURE:inbound_measure:skus:2'])
  })
  it('旧整单费用已收1个SKU时仅补新SKU，已收费用不改写', async () => {
    const f = fixture();const legacy = { quantity: 1, amount: 0.5, status: 'confirmed' };f.charges.push(legacy)
    f.logs.push({ action: 'measure_inbound', detail: { request: { measureItems: [{ id: 2 }] } } });await f.service.recordMeasuredSkus(f.order)
    expect(f.charges[0]).toBe(legacy);expect(f.charges[1]).toMatchObject({ quantity: 1, amount: 0.5, calcBasis: { measuredSkuCount: 2, previouslyBilledSkuCount: 1 } })
  })
  it('同SKU多明细去重，合并清点测量中的零实收明细不收费', async () => {
    const f = fixture();f.logs.push({ action: 'qc_measure', detail: { request: { items: [{ id: 3, actualQty: 1 }, { id: 2, actualQty: 0 }] } } });await f.service.recordMeasuredSkus(f.order)
    expect(f.charges).toHaveLength(1);expect(f.charges[0].quantity).toBe(1)
  })
  it('没有测量凭据时不因商品已有尺寸而收费', async () => {
    const f = fixture();f.logs.splice(0);expect(await f.service.recordMeasuredSkus(f.order)).toMatchObject({ measuredSkuCount: 0 });expect(f.billing.createCharge).not.toHaveBeenCalled()
  })
  it('旧凭据不完整或费用取消时明确失败，不能猜测收费', async () => {
    const f = fixture();f.logs.push({ action: 'measure_inbound', detail: {} });await expect(f.service.recordMeasuredSkus(f.order)).rejects.toThrow('凭据不完整');expect(f.charges).toEqual([])
    f.logs.pop();f.charges.push({ status: 'cancelled', quantity: 1 });await expect(f.service.recordMeasuredSkus(f.order)).rejects.toThrow('财务核对')
  })
  it('费用提交后同步失败保留可重试结果，重试不新增费用', async () => {
    const f = fixture();f.billing.pushCustomerBillingToOms.mockResolvedValueOnce(false)
    await expect(f.service.recordMeasuredSkus(f.order)).rejects.toThrow('同步待核对');await f.service.recordMeasuredSkus(f.order);expect(f.charges).toHaveLength(1)
  })
})
