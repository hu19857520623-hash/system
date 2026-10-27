import assert from 'node:assert/strict'
import test from 'node:test'
import { assertApiReadAccess, filterBootstrapReads, readResourceForPath } from './read-access.util.js'
import { canReadData } from '../src/data/readAccess.js'
import { assertApiWritePermission, type AuthenticatedRequest } from './auth.js'
import type { Response } from 'express'

const identity = (permissions: string[], role='hybrid') => ({role,permissions})
const data = { products:[{id:'product'}],inventory:[{id:'stock'}],orders:[{id:'order'}],inboundOrders:[{id:'inbound'}],
  outboundOrders:[{id:'outbound'}],returnOrders:[{id:'return'}],logistics:[{id:'logistics'}],platformSkuMappings:[{id:'mapping'}],
  stores:[{id:'store'}],purchases:[{id:'purchase'}],systemMessages:[{id:'message'}],announcements:[{id:'announcement'}],
  billing:{creditBalance:10,monthlySpent:30,pendingBill:5,budgetUsed:70,name:'客户'},billingAccounts:[{history:'private'}],feeRecords:[{id:'fee'}],accounts:[{id:'own'}] }
test('product and inventory readers receive only their permitted business arrays and no financial payload',()=>{
  const result=filterBootstrapReads(data,identity(['product:read','inventory:read']))
  assert.deepEqual(result.products,data.products);assert.deepEqual(result.inventory,data.inventory)
  for(const key of ['orders','inboundOrders','outboundOrders','returnOrders','logistics','platformSkuMappings','stores','purchases','systemMessages','announcements','billingAccounts','feeRecords'] as const)assert.deepEqual(result[key],[],key)
  assert.equal(result.billing,null);assert.deepEqual(data.inboundOrders,[{id:'inbound'}])
})
test('checkout permissions allow own balance and necessary inventory without fee, bill or recharge history',()=>{
  for(const permission of ['catalog:write','outbound:write']) {
    const result=filterBootstrapReads(data,identity([permission]))
    assert.equal(result.billing?.creditBalance,10);assert.equal('monthlySpent' in result.billing!,false)
    assert.deepEqual(result.feeRecords,[]);assert.deepEqual(result.billingAccounts,[]);assert.deepEqual(result.inventory,data.inventory)
    assert.equal(assertApiReadAccess(identity([permission]),'GET','/erp/customers/TKL1/balance'),true)
    const response={status:()=>response,json:()=>response} as unknown as Response
    const request={method:'POST',path:'/erp/customers/TKL1/inventory-sync',auth:identity([permission])} as AuthenticatedRequest
    assert.equal(assertApiWritePermission(request,response),true)
    assert.equal(assertApiWritePermission({...request,method:'PUT',path:'/inventory-products'} as AuthenticatedRequest,response),false)
    for(const path of ['/billing','/erp/customers/TKL1/billing-snapshot','/erp/customers/TKL1/bills','/erp/customers/TKL1/charges','/erp/customers/TKL1/recharges'])assert.equal(assertApiReadAccess(identity([permission]),'GET',path),false,path)
  }
})
test('form dependencies preserve SKU choices without granting other business histories',()=>{
  for(const permission of ['inbound:write','returns:write','platform:read']) {
    const auth=identity([permission]);assert.equal(canReadData(auth,'products'),true)
    assert.equal(canReadData(auth,'orders'),false);assert.equal(canReadData(auth,'outboundOrders'),false)
  }
  assert.equal(canReadData(identity(['inventory:read']),'outboundOrders'),false)
  assert.equal(canReadData(identity(['order:read']),'outboundOrders'),true)
})
test('list, detail, attachment and HEAD reads share the same business permission requirement',()=>{
  for(const [resource,permission,paths] of [
    ['inboundOrders','inbound:read',['/erp/inbound/by-customer/TKL1','/erp/inbound/RV1']],
    ['outboundOrders','outbound:read',['/erp/outbound/by-customer/TKL1','/erp/outbound/DO1/pod','/erp/outbound/by-customer/TKL1/sku/A/outbounds']],
    ['returnOrders','returns:read',['/erp/returns/by-customer/TKL1','/erp/returns/RT1/attachment/a']],
    ['logistics','logistics:read',['/erp/logistics/by-customer/TKL1']],
  ] as const) for(const path of paths)for(const method of ['GET','HEAD']) {
    assert.equal(readResourceForPath(method,path),resource)
    assert.equal(assertApiReadAccess(identity(['product:read']),method,path),false)
    assert.equal(assertApiReadAccess(identity([permission]),method,path+'/?x=1'),true)
  }
})
test('admin keeps all scoped resources; ordinary read access never substitutes for mutation checks',()=>{
  assert.equal(filterBootstrapReads(data,identity([],'sys_admin')),data)
  assert.equal(assertApiReadAccess(identity([],'sys_admin'),'GET','/erp/outbound/DO1'),true)
  assert.equal(readResourceForPath('POST','/erp/outbound'),null)
  assert.equal(readResourceForPath('GET','/bootstrap'),null)
})
test('billing and recharge history remain distinct; dashboard does not grant business histories',()=>{
  const auth=identity(['dashboard:read','billing:recharge'])
  const result=filterBootstrapReads(data,auth);assert.deepEqual(result.announcements,data.announcements)
  assert.deepEqual(result.outboundOrders,[]);assert.deepEqual(result.feeRecords,[])
  assert.equal(assertApiReadAccess(auth,'GET','/erp/customers/TKL1/recharges'),true)
  assert.equal(assertApiReadAccess(auth,'GET','/erp/customers/TKL1/bills'),false)
  assert.equal(assertApiReadAccess(identity(['billing:read']),'GET','/erp/customers/TKL1/charges'),true)
})
