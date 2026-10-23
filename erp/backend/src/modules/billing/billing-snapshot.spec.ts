import 'reflect-metadata'
import { billingSourceSnapshot } from './billing-snapshot.util'
import { BillingService } from './billing.service'
function fixture() {
  const customer = { id: 1n, customerCode: 'TKL9001', customerName: '隔离账务', balance: '100.00' }
  const charge = (id: number, amount: string, source: string, ref: string | null, bill: bigint | null, day = '2026-10-23') => ({ id: BigInt(id), customer_id: 1n, charge_no: `CHG-${id}`, amount, source, biz_ref: ref, billing_id: bill, charge_date: day, status: 'confirmed', charge_type: 'handling' })
  const charges = [charge(1,'12.40','erp','DO-1',null),charge(2,'30.00','erp','DO-1',null),charge(3,'3.50','manual',null,8n),charge(4,'10.00','erp','DO-2',null),
    ...Array.from({length:251},(_,i)=>charge(i+10,'1.00','manual',null,7n)),charge(300,'2.00','manual',null,7n,'2026-09-20'),charge(301,'3.00','manual',null,7n,'2026-11-01')]
  const orders = [
    { id:1n,outboundNo:'DO-1',customerId:1n,shippedAt:new Date('2026-10-20'),createdAt:new Date('2026-10-19'),status:'shipped',remark:'[oms_pre_deduct:{"preDeductTotal":40,"lines":[]}]' },
    { id:2n,outboundNo:'DO-2',customerId:1n,shippedAt:null,createdAt:new Date('2026-10-23'),status:'packed',remark:'[oms_pre_deduct:{"preDeductTotal":10,"lines":[]}]' },
    { id:3n,outboundNo:'DO-3',customerId:1n,shippedAt:null,createdAt:new Date('2026-10-19'),status:'cancelled',remark:'[oms_pre_deduct:{"preDeductTotal":5,"lines":[]}]' },
  ]
  const bills = [{id:7n,customerId:1n,billingNo:'BL-PAID',billingMonth:'2026-10',status:'paid',paidAmount:'256.00',totalAmount:'256.00'}, {id:8n,customerId:1n,billingNo:'BL-UNPAID',billingMonth:'2026-10',status:'confirmed',paidAmount:'0.00',totalAmount:'3.50'}]
  const db: any = {
    customer: { findUnique: async ({where}:any) => where.customerCode==='TKL9001'?customer:null },
    $queryRawUnsafe: async () => charges,
    billingOrder: { findMany: async ({where}:any) => where.id?bills.filter(b=>where.id.in.includes(b.id)):bills },
    outboundOrder: { findMany: async ({where}:any) => where.outboundNo?orders.filter(o=>where.outboundNo.in.includes(o.outboundNo)):orders },
    operationLog: { findMany: async () => [], findFirst: async ({where}:any) => where.targetId==='DO-1'?{detail:{customerId:1,allocations:[{chargeId:1,paidAmount:12.4},{chargeId:2,paidAmount:30}]}}:null },
    customerRecharge: { findMany: async () => [{ rechargeNo:'RC-1',amount:'100.00',createdAt:new Date('2026-10-01'),paymentMethod:'bank' }] },
    $transaction: async (work:any) => work(db),
  }
  return {db,customer,charges,orders,bills}
}
describe('权威账务只读快照及统一统计范围', () => {
  it('251笔以上已付费用完整读取，未付账单和未发运预估费用分开', async () => {
    const f=fixture(), before=structuredClone({charges:f.charges,orders:f.orders,bills:f.bills,customer:f.customer})
    const result=await billingSourceSnapshot(f.db,f.customer,new Date('2026-10-23'))
    expect(result).toMatchObject({pendingTotal:3.5,monthlyTotal:293.4,reservedAmount:10,provisionalChargeCount:1,reviewAmount:0,billingMonth:'2026-10'})
    expect(result.feeRecords.filter(r=>r.method==='actual'&&r.type!=='recharge')).toHaveLength(255)
    expect(result.feeRecords.find(r=>r.id==='settle-DO-1')?.amount).toBe(-2.4)
    expect(result.feeRecords.find(r=>r.id==='settle-DO-3')?.amount).toBe(5)
    expect({charges:f.charges,orders:f.orders,bills:f.bills,customer:f.customer}).toEqual(before)
  })
  it('未知已发运支付依据明确待财务核对，不猜测成未付再收费', async () => {
    const f=fixture();f.charges.push({...f.charges[0],id:900n,amount:'20.00',biz_ref:'DO-4'})
    f.orders.push({...f.orders[0],id:4n,outboundNo:'DO-4',remark:''})
    expect(await billingSourceSnapshot(f.db,f.customer,new Date('2026-10-23'))).toMatchObject({pendingTotal:3.5,reviewAmount:20})
  })
  it('正式读取同一客户余额、全量账单及费用，读取接口不修复或写缓存', async () => {
    const f=fixture(), service=new BillingService(f.db)
    const result=await service.snapshotForOms(' tkl9001 ')
    expect(result.customerCode).toBe('TKL9001');expect(result.creditBalance).toBe(100);expect(result.bills).toHaveLength(2)
    await expect(service.snapshotForOms('OTHER')).rejects.toThrow('客户不存在')
  })
})
