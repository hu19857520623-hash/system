import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { OutboundBillingService } from './outbound-billing.service'
import { billingPaidChargeIds } from '../billing/billing-workflow.util'

function fixture() {
  let state: any = {
    customer: { id: 260n, customerCode: 'TKL-TEST', balance: '20.00' },
    order: { id: 1n, outboundNo: 'DO-TEST', customerId: 260n, status: 'shipped', shippedAt: new Date('2026-11-01'), items: [{ qty: 1 }] },
    charges: [
      { id: 1n, charge_no: 'CHG-1', charge_type: 'handling', amount: '3.00', source: 'erp', customer_id: 260n, biz_ref: 'DO-TEST', status: 'pending', billing_id: null, description: '出库打包' },
      { id: 2n, charge_no: 'CHG-2', charge_type: 'outbound_ship', amount: '7.00', source: 'erp', customer_id: 260n, biz_ref: 'DO-TEST', status: 'pending', billing_id: null, description: '出库运费' },
    ],
    operations: [] as any[],
  }
  let queue = Promise.resolve()
  const db = (get: () => any): any => ({
    $queryRaw: jest.fn().mockResolvedValue([]),
    $queryRawUnsafe: async (sql: string) => {
      if (sql.includes('oms_systemmessage')) return []
      if (sql.includes('billing_charge')) return get().charges.map((c: any) => ({ ...c }))
      return []
    },
    customer: { findUnique: async () => get().customer, update: jest.fn(async ({ data }: any) => { get().customer.balance = (Number(get().customer.balance) + Number(data.balance.increment)).toFixed(2); return get().customer }) },
    outboundOrder: { findUnique: async () => get().order, findMany: async () => [get().order] },
    billingOrder: { findMany: async () => [] },
    operationLog: {
      findFirst: async ({ where }: any) => [...get().operations].reverse().find((o: any) => o.module === where.module && o.action === where.action && (!where.targetId || o.targetId === where.targetId)
        && (!where.detail || o.detail?.clientRequestId === where.detail.equals)) || null,
      create: async ({ data }: any) => { get().operations.push(data); return data },
    },
  })
  const prisma: any = db(() => state)
  prisma.$transaction = (work: any) => {
    const result = queue.then(async () => { const draft = structuredClone(state); const tx = db(() => draft); tx._state = draft; const value = await work(tx); state = draft; return value })
    queue = result.then(() => undefined, () => undefined)
    return result
  }
  const service = new OutboundBillingService(prisma, {} as any)
  return { service, prisma, state: () => state, txCustomerUpdate: prisma.customer.update }
}

const valid = () => ({ clientRequestId: randomUUID(), reason: '已与原发运扣款流水核对一致', confirmedTotal: 10 })

describe('财务核对补记历史发运支付凭据', () => {
  it('补记只写凭据：余额不动、费用不动，逐笔分配可供账务识别为已付', async () => {
    const { service, prisma, state } = fixture()
    const result = await service.verifyHistoricShipPayment(1, valid(), 7)
    expect(result).toMatchObject({ verified: true, outboundNo: 'DO-TEST', totalAmount: 10, balanceDelta: 0 })
    expect(result.message).toContain('未改余额')
    expect(state().customer.balance).toBe('20.00')
    expect(prisma.customer.update).not.toHaveBeenCalled()
    expect(state().charges.map((c: any) => c.amount)).toEqual(['3.00', '7.00'])
    const receipt = state().operations[0]
    expect(receipt).toMatchObject({ module: 'billing', action: 'outbound_payment', targetType: 'outbound_order', targetId: 'DO-TEST', operatorId: 7n })
    expect(receipt.detail).toMatchObject({ manualVerification: true, balanceDelta: 0, balanceBefore: 20, balanceAfter: 20 })
    expect(receipt.detail.allocations).toEqual([
      { chargeId: 1, chargeNo: 'CHG-1', chargeType: 'handling', paidAmount: 3 },
      { chargeId: 2, chargeNo: 'CHG-2', chargeType: 'outbound_ship', paidAmount: 7 },
    ])
    // 跨模块核对：账务支付依据识别逐笔成立
    const paid = await billingPaidChargeIds(prisma, state().customer, state().charges)
    expect([...paid].sort()).toEqual(['1', '2'])
    // 补记后发运同步恢复入口不再拒绝
    await expect(service.paidShipCharges(state().order)).resolves.toHaveLength(2)
  })

  it('原请求重放只核对不重复写入，凭据仍只有一条', async () => {
    const { service, state } = fixture()
    const request = valid()
    const first = await service.verifyHistoricShipPayment(1, request, 7)
    expect(first.verified).toBe(true)
    const replay = await service.verifyHistoricShipPayment(1, request, 7)
    expect(replay).toMatchObject({ duplicate: true, outboundNo: 'DO-TEST' })
    expect(replay.message).toContain('未重复写入')
    expect(state().operations).toHaveLength(1)
  })

  it('已有完整或不完整凭据都拒绝重复补记，不覆盖原凭据', async () => {
    const { service, state } = fixture()
    await service.verifyHistoricShipPayment(1, valid(), 7)
    const other = { ...valid(), reason: '另一人重复核对' }
    await expect(service.verifyHistoricShipPayment(1, other, 8)).rejects.toThrow('已有完整发运支付凭据')
    expect(state().operations).toHaveLength(1)
    state().operations[0].detail.allocations = [{ chargeId: 1, paidAmount: 3 }]
    await expect(service.verifyHistoricShipPayment(1, valid(), 8)).rejects.toThrow('不完整的历史发运凭据')
    expect(state().operations).toHaveLength(1)
    expect(state().customer.balance).toBe('20.00')
  })

  it('核对合计与系统费用不一致时中文拒绝且零写入', async () => {
    const { service, state } = fixture()
    await expect(service.verifyHistoricShipPayment(1, { ...valid(), confirmedTotal: 9 }, 7)).rejects.toThrow('与系统费用合计')
    expect(state().operations).toHaveLength(0)
  })

  it('未发运、无费用或单据不存在都不能补记', async () => {
    const { service, state } = fixture()
    state().order.status = 'packed'
    state().order.shippedAt = null
    await expect(service.verifyHistoricShipPayment(1, valid(), 7)).rejects.toThrow('尚未完成发运')
    state().order.status = 'shipped'
    state().order.shippedAt = new Date('2026-11-01')
    state().charges = []
    await expect(service.verifyHistoricShipPayment(1, valid(), 7)).rejects.toThrow('没有需要核对的历史发运费用')
    expect(state().operations).toHaveLength(0)
  })

  it.each([
    [{ ...valid(), clientRequestId: 'bad-id' }, '原核对操作标识'],
    [{ ...valid(), reason: '短' }, '核对说明'],
    [{ ...valid(), confirmedTotal: -1 }, '金额无效'],
    [{ ...valid(), confirmedTotal: NaN }, '金额无效'],
  ] as const)('非法入参中文拒绝 %p', async (payload, message) => {
    const { service, state } = fixture()
    await expect(service.verifyHistoricShipPayment(1, payload as any, 7)).rejects.toThrow(message)
    expect(state().operations).toHaveLength(0)
  })
})
