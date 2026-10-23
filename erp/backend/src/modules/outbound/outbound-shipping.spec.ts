import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { OutboundService } from './outbound.service'
import { OutboundBillingService } from './outbound-billing.service'

function fixture() {
  let state: any = {
    customer: { id: 260n, customerCode: 'TKL-TEST', balance: '20.00' },
    order: { id: 1n, outboundNo: 'DO-TEST', customerId: 260n, status: 'packed', shippedAt: null, needsRelabel: false, relabelPrintCount: 0, warehouseCode: 'WMS-TEST', destType: 'jhb',
      remark: '[oms_pre_deduct:{"preDeductTotal":10,"lines":[]}] [oms_actual_fees:{"actualTotal":15,"lines":[{"chargeType":"handling","amount":5},{"chargeType":"outbound_ship","amount":10}]}]',
      items: [{ productId: 1n, sku: 'SKU-TEST', qty: 1, pickedQty: 1 }], pickAllocations: [{ id: 1n, status: 'picked' }] },
    charges: [{ id: 1n, charge_type: 'handling', amount: '3.00' }, { id: 2n, charge_type: 'outbound_ship', amount: '7.00' }].map(c => ({ ...c, charge_no: `CHG-${c.id}`, source: 'erp', customer_id: 260n, biz_ref: 'DO-TEST', status: 'pending', billing_id: null })),
    inventory: { totalQty: 5, lockedQty: 1 }, operations: [], stockLogs: [],
  }
  let fail = '', queue = Promise.resolve()
  const db = (get: () => any): any => ({
    $queryRaw: jest.fn().mockResolvedValue([]),
    $queryRawUnsafe: async (sql: string) => {
      if (sql.includes('JOIN customer cust')) return get().order.shippedAt ? get().charges : []
      if (sql.startsWith('SELECT id,amount')) return get().charges
      if (sql.includes('billing_charge')) return get().charges
      return []
    },
    $executeRawUnsafe: async (_sql: string, amount: number, _price: number, description: string, id: bigint) => { Object.assign(get().charges.find((c: any) => c.id === id), { amount: String(amount), description });return 1 },
    customer: { findUnique: async () => get().customer, update: async ({ data }: any) => { get().customer.balance = (Number(get().customer.balance) + Number(data.balance.increment)).toFixed(2);return get().customer } },
    outboundOrder: { findUnique: async () => get().order, findMany: async () => [get().order], updateMany: async ({ data }: any) => { if (get().order.status !== 'packed') return { count: 0 };Object.assign(get().order, data);return { count: 1 } } },
    outboundPickAllocation: { updateMany: async ({ data }: any) => Object.assign(get().order.pickAllocations[0], data) },
    operationLog: {
      findFirst: async ({ where }: any) => get().operations.find((o: any) => o.module === where.module && o.action === where.action && (!where.operatorId || o.operatorId === where.operatorId) && (!where.targetId || o.targetId === where.targetId) && (!where.detail || o.detail.clientRequestId === where.detail.equals)) || null,
      create: async ({ data }: any) => { if (data.action === fail) throw new Error('末尾凭据失败');get().operations.push(data);return data },
    },
  })
  const prisma = db(() => state)
  prisma.$transaction = (work: any) => {
    const result = queue.then(async () => { const draft = structuredClone(state), tx = db(() => draft);tx._state = draft;const result = await work(tx);state = draft;return result })
    queue = result.then(() => undefined, () => undefined);return result
  }
  const billing: any = { createCharge: jest.fn(), pushCustomerBillingToOms: jest.fn().mockResolvedValue(true) }
  const inventory: any = { shipDeductWarehouse: jest.fn(async (tx: any) => { if (fail === 'stock') throw new Error('库存失败');tx._state.inventory.totalQty--;tx._state.inventory.lockedQty--;tx._state.stockLogs.push({ qty: -1 }) }) }
  const service = new OutboundService(prisma, billing, new OutboundBillingService(prisma, billing), inventory, {} as any, {} as any)
  jest.spyOn(service, 'detail').mockImplementation(async () => ({ ...state.order, id: 1 }) as any)
  const fees = jest.spyOn(service as any, 'pushOutboundFeesToOms').mockResolvedValue(true), status = jest.spyOn(service as any, 'pushOutboundStatusToOms').mockResolvedValue(true)
  const input = { clientRequestId: randomUUID(), trackingNo: 'TRACK-TEST', carrier: '', logisticsProduct: '' }
  return { service, prisma, state: () => state, input, fees, status, billing, inventory, fail: (value: string) => { fail = value } }
}

describe('发运库存、费用与原请求恢复', () => {
  it('预扣10、实算15，只补扣5；费用更新与库存和两份凭据一起保存', async () => {
    const f = fixture();expect(await f.service.ship(1, 1, f.input)).toMatchObject({ status: 'shipped', feePending: false, syncPending: false })
    expect(f.state().customer.balance).toBe('15.00');expect(f.state().charges.map((c: any) => c.amount)).toEqual(['5', '10'])
    expect(f.state().inventory).toEqual({ totalQty: 4, lockedQty: 0 });expect(f.state().stockLogs).toHaveLength(1)
    expect(f.state().operations.map((o: any) => o.action)).toEqual(['outbound_payment', 'ship'])
  })
  it.each(['outbound_payment', 'ship', 'stock'])('%s失败时费用、余额、发运状态及库存全部回滚', async action => {
    const f = fixture(), before = structuredClone(f.state());f.fail(action)
    await expect(f.service.ship(1, 1, f.input)).rejects.toThrow(/失败/);expect(f.state()).toEqual(before);expect(f.fees).not.toHaveBeenCalled()
  })
  it('原请求重放不再次扣费/库存，改内容或换单号不能冒用原凭据', async () => {
    const f = fixture();await f.service.ship(1, 1, f.input);f.state().customer.balance = '9.00';const before = structuredClone(f.state())
    expect(await f.service.ship(1, 1, f.input)).toMatchObject({ duplicate: true });expect(f.state()).toEqual(before)
    await expect(f.service.ship(1, 1, { ...f.input, trackingNo: 'OTHER' })).rejects.toThrow('内容不同')
    await expect(f.service.ship(2, 1, f.input)).rejects.toThrow('内容不同')
  })
  it('不同操作者并发发运同一单只能提交一次', async () => {
    const f = fixture();const results = await Promise.allSettled([f.service.ship(1, 1, f.input), f.service.ship(1, 2, { ...f.input, clientRequestId: randomUUID() })])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);expect(f.state().customer.balance).toBe('15.00');expect(f.state().stockLogs).toHaveLength(1)
  })
  it('余额不足可充值后用原请求继续，不留下半张发运单', async () => {
    const f = fixture();f.state().customer.balance = '3.00';const before = structuredClone(f.state())
    await expect(f.service.ship(1, 1, f.input)).rejects.toThrow('余额不足');expect(f.state()).toEqual(before)
    f.state().customer.balance = '10.00';expect(await f.service.ship(1, 1, f.input)).toMatchObject({ status: 'shipped' });expect(f.state().customer.balance).toBe('5.00')
  })
  it('预扣多于最终金额时只退差额', async () => {
    const f = fixture();f.state().order.remark = f.state().order.remark.replace('"preDeductTotal":10', '"preDeductTotal":20')
    await f.service.ship(1, 1, f.input);expect(f.state().customer.balance).toBe('25.00')
  })
  it('通知失败保留已提交结果，原请求及同步入口只补通知', async () => {
    const f = fixture();f.fees.mockResolvedValueOnce(false);f.status.mockResolvedValueOnce(false)
    expect(await f.service.ship(1, 1, f.input)).toMatchObject({ feePending: true, syncPending: true })
    const before = structuredClone(f.state());expect(await f.service.ship(1, 1, f.input)).toMatchObject({ duplicate: true, feePending: false, syncPending: false })
    await f.service.syncShipment(1);expect(f.state()).toEqual(before);expect(f.inventory.shipDeductWarehouse).toHaveBeenCalledTimes(1)
  })
  it('预估费用已经入账且与实算不同会明确拒绝，不能暗改旧账单', async () => {
    const f = fixture();f.state().charges[0].billing_id = 1n;const before = structuredClone(f.state())
    await expect(f.service.ship(1, 1, f.input)).rejects.toThrow('与实测不一致');expect(f.state()).toEqual(before)
  })
  it('有预扣却没有实测计费时引导回到复核打包', async () => {
    const f = fixture();f.state().order.remark = '[oms_pre_deduct:{"preDeductTotal":10,"lines":[]}]'
    await expect(f.service.ship(1, 1, f.input)).rejects.toThrow('复核打包');expect(f.state().order.status).toBe('packed')
  })
  it('尚未发运不能使用仅同步入口；无完整旧支付依据也不补扣', async () => {
    const f = fixture();await expect(f.service.syncShipment(1)).rejects.toThrow('请先完成发运')
    Object.assign(f.state().order, { status: 'shipped', shippedAt: new Date() })
    await expect(f.service.syncShipment(1)).rejects.toThrow('本次未再扣款');expect(f.state().customer.balance).toBe('20.00')
  })
})
