import 'reflect-metadata'
import { BillingService } from './billing.service'
import { notifyOms } from '../../common/oms-notify.util'
jest.mock('../../common/oms-notify.util', () => ({ notifyOms: jest.fn().mockResolvedValue(true) }))

describe('OMS 账务镜像只认已支付费用', () => {
  it('生成账单后未支付仍在待付；旧发运已付不再计入待付；确认后才转为实扣', async () => {
    const charges = [
      { id: 49n, amount: '12.40', source: 'erp', biz_ref: 'DO-1', charge_type: 'handling', billing_id: 1n },
      { id: 50n, amount: '30.00', source: 'erp', biz_ref: 'DO-1', charge_type: 'outbound_ship', billing_id: null },
      { id: 57n, amount: '3.50', source: 'manual', biz_ref: null, charge_type: 'handling', billing_id: 1n },
    ].map(c => ({ ...c, customer_id: 260n, charge_no: `CHG-${c.id}`, charge_date: '2026-10-23', status: c.billing_id ? 'confirmed' : 'pending' }))
    const bill = { id: 1n, status: 'pending', totalAmount: '15.90', paidAmount: '0.00' }
    const db: any = {
      customer: { findUnique: jest.fn().mockResolvedValue({ id: 260n, customerCode: 'TKL9001', balance: '57.60' }) },
      billingOrder: { findMany: jest.fn(async () => [bill]) },
      outboundOrder: { findMany: jest.fn().mockResolvedValue([{ outboundNo: 'DO-1', shippedAt: new Date(), status: 'shipped' }]) },
      operationLog: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      customerRecharge: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRawUnsafe: jest.fn(async (sql: string) => {
        if (sql.includes('FROM oms_systemmessage')) return [{ title: '出库 DO-1 费用已结算', content: '实扣 ¥42.40，预扣 ¥0.00，无差额' }]
        if (sql.startsWith('SELECT id,amount')) return charges.slice(0, 2)
        return charges
      }),
    }
    const service = new BillingService(db)
    jest.spyOn(service as any, 'ensureOmsBillingMirror').mockResolvedValue(undefined)
    expect(await service.pushCustomerBillingToOms(260)).toBe(true)
    const first = (notifyOms as jest.Mock).mock.calls.at(-1)[2]
    expect(first.pendingBill).toBe(3.5)
    expect(first.charges.map((c: any) => c.id)).toEqual([49, 50])
    expect(first.removeChargeIds).toEqual([57])
    Object.assign(bill, { status: 'paid', paidAmount: '15.90' })
    db.customer.findUnique.mockResolvedValue({ id: 260n, customerCode: 'TKL9001', balance: '54.10' })
    expect(await service.pushCustomerBillingToOms(260)).toBe(true)
    const paid = (notifyOms as jest.Mock).mock.calls.at(-1)[2]
    expect(paid.pendingBill).toBe(0)
    expect(paid.balance).toBe(54.1)
    expect(paid.charges.map((c: any) => c.id)).toEqual([49, 50, 57])
  })
})
