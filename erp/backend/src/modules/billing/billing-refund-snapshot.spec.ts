import { billingSourceSnapshot } from './billing-snapshot.util'
import { catalogRefundReference } from './catalog-refund-ledger.util'
function fixture(chargeDate='2026-10-23') {
  const customer={id:1n,customerCode:'TKL9001',balance:'11.25'}
  const order={id:21n,customerId:1n,customerCode:'TKL9001',orderNo:'CAT-1',sku:'TKL-A',quantity:2,unitPrice:'1.25',totalAmount:'2.50',balanceBefore:'100',balanceAfter:'97.50',status:'confirmed'}
  const charge={id:31n,customer_id:1n,charge_no:'CHG-1',amount:'2.50',source:'oms',charge_type:'catalog_purchase',biz_ref:'CAT-1',charge_date:chargeDate,status:'confirmed'}
  const clientRequestId='3f0cc282-1737-4f29-8e0c-e32076fc33e0',referenceNo=catalogRefundReference(7,clientRequestId)
  const receipt={operatorId:7n,createdAt:new Date('2026-10-23'),detail:{customerId:1,refundVersion:1,clientRequestId,refund:{amountCents:125,balanceBefore:10,balanceAfter:11.25,allocations:[{orderId:21,orderNo:'CAT-1',quantity:1,unitCents:125,amountCents:125}]},response:{clientRequestId,customerCode:'TKL9001',quantity:1,refundAmount:1.25,referenceNo}}}
  const db:any={$queryRawUnsafe:async(sql:string)=>sql.includes('SELECT id,amount')?[{id:31n,amount:'2.50'}]:[charge],outboundOrder:{findMany:async()=>[]},customerRecharge:{findMany:async()=>[]},billingOrder:{findMany:async()=>[]},omsCatalogOrder:{findMany:async()=>[order]},billingCharge:{findMany:async()=>[{id:31n,bizRef:'CAT-1',amount:'2.50',status:'confirmed'}]},operationLog:{findMany:async()=>[receipt]}}
  return {db,customer,receipt}
}
describe('货盘退款账务来源',()=>{
  it('付款和退款分列，余额来自客户，待付不增，月度净支出只扣一次退款',async()=>{
    const f=fixture(),r=await billingSourceSnapshot(f.db,f.customer,new Date('2026-10-23'))
    expect(r).toMatchObject({pendingTotal:0,monthlyTotal:1.25})
    expect(r.feeRecords.map(r=>[r.type,r.amount])).toEqual(expect.arrayContaining([['catalog_purchase',-2.5],['catalog_refund',1.25]]))
    expect((await billingSourceSnapshot(f.db,f.customer,new Date('2026-10-23'))).feeRecords).toEqual(r.feeRecords)
  })
  it('退还上月已付费用计入本月退款，可形成负的月度净支出',async()=>{
    const f=fixture('2026-09-01');expect((await billingSourceSnapshot(f.db,f.customer,new Date('2026-10-23'))).monthlyTotal).toBe(-1.25)
  })
  it('残缺退款凭据明确要求财务核对，不显示不可信金额',async()=>{
    const f=fixture();f.receipt.detail.refund.balanceAfter=99
    await expect(billingSourceSnapshot(f.db,f.customer)).rejects.toThrow('退款回执不完整')
  })
})
