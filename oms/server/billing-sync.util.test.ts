import test from 'node:test'
import assert from 'node:assert/strict'
import { applyErpBillingChanged, openPreDeductTotal } from './billing-sync.util.js'
import { mapErpChargeType } from '../src/data/chargeType.js'

test('open pre-deduct total ignores settled and refunded references', () => {
  assert.equal(openPreDeductTotal([]), 0)
  assert.equal(openPreDeductTotal([
    { id: 'pre-1', method: 'pre_deduct', amount: -80, refNo: 'OB-1' },
    { id: 'pre-2', method: 'pre_deduct', amount: -20, refNo: 'OB-2' },
    { id: 'settle-OB-1', method: 'settlement_adjust', amount: 10, refNo: 'OB-1' },
    { id: 'actual-1', method: 'actual', amount: -15, refNo: 'OB-2' },
  ]), 20)
  assert.equal(openPreDeductTotal([
    { id: 'pre-3', method: 'pre_deduct', amount: -50, refNo: 'OB-3' },
    { id: 'refund-OB-3', method: 'settlement_adjust', amount: 50, refNo: 'OB-3' },
  ]), 0)
})

test('maps ERP outbound shipping charges onto OMS shipping fees', () => {
  assert.equal(mapErpChargeType('outbound_ship'), 'shipping')
  assert.equal(mapErpChargeType(''), 'other')
  assert.equal(mapErpChargeType('handling'), 'handling')
})

test('货盘退款流水为正数且按原回执upsert，通知重试不重复加余额或流水',async()=>{
 const fees=new Map<string,any>(),account={id:'c1',name:'客户',code:'TKL9001',contact:'联系人',warehouse:'jhb1'},balance={creditBalance:10}
 const tx={billingAccount:{findUnique:async()=>({id:'b1',...balance}),update:async({data}:any)=>Object.assign(balance,data)},feeRecord:{deleteMany:async()=>{},upsert:async({where,create,update}:any)=>fees.set(where.id,fees.has(where.id)?update:create)}}
 const prisma={$transaction:async(fn:any)=>fn(tx)} as any
 const payload={balance:11.25,monthlySpent:1.25,refunds:[{referenceNo:'RCL-'+'a'.repeat(32),amount:1.25,createdAt:'2026-10-23',allocations:[{orderNo:'CAT-1',quantity:1}]}]}
 await applyErpBillingChanged(prisma,'TKL9001',account,payload);await applyErpBillingChanged(prisma,'TKL9001',account,payload)
 assert.equal(balance.creditBalance,11.25);assert.equal(fees.size,1);assert.equal([...fees.values()][0].type,'catalog_refund');assert.equal([...fees.values()][0].amount,1.25)
 assert.equal([...fees.keys()][0].length,44)
})
