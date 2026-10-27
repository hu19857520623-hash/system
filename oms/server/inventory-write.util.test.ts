import assert from 'node:assert/strict'
import test from 'node:test'
import { applyErpInventoryView, inventoryProductsInput, productWriteFields, saveInventoryProducts } from './inventory-write.util.js'

test('metadata cannot update stock, catalog membership or catalog commercial data; new stock is zero',()=>{
  const data={customerId:'c1',name:'商品',availableQty:999,lockedQty:999,inCatalog:true,price:7,cost:3}
  assert.deepEqual(productWriteFields(data,{inCatalog:false}),{customerId:'c1',name:'商品',price:7,cost:3})
  assert.deepEqual(productWriteFields(data,{inCatalog:true}),{customerId:'c1',name:'商品'})
  assert.deepEqual(productWriteFields(data),{customerId:'c1',name:'商品',price:7,cost:3,availableQty:0,lockedQty:0,inCatalog:false})
})
test('batches require distinct valid IDs and a bounded non-empty selection',()=>{
  for(const value of [null,{},[],[{id:'a'},{id:'a'}],[{id:'a'.repeat(51)}],Array.from({length:501},(_,i)=>({id:String(i)}))]) assert.throws(()=>inventoryProductsInput(value))
  assert.deepEqual(inventoryProductsInput([{id:'one'}]),[{id:'one'}])
})
function productsFixture() {
  const rows=new Map<string,any>([['own',{id:'own',customerId:'c1',internalSku:'TKL1-A',customerSku:'A',name:'原名称',availableQty:5,lockedQty:2,inCatalog:false,productStatus:'available'}],['other',{id:'other',customerId:'c2'}]])
  const calls:any[]=[]
  const tx:any={
    $queryRaw:async()=>{calls.push('account-lock');return [{id:'c1'}]},
    product:{findUnique:async({where}:any)=>{calls.push('read-product');return rows.get(where.id)||null},upsert:async({where,create,update}:any)=>{const next=rows.has(where.id)?{...rows.get(where.id),...update}:create;rows.set(where.id,next);return next}},
  }
  const db:any={$transaction:async(fn:any)=>fn(tx)},skuCalls:any[]=[]
  const save=(input:any[],scope:string|null='c1')=>saveInventoryProducts(db,input,scope,(r,owner)=>({...r,customerId:owner}),()=>undefined,async(_tx,data)=>{skuCalls.push(data)})
  return {rows,calls,tx,save,skuCalls}
}
test('selected metadata saves preserve canonical quantities and owner',async()=>{
  const f=productsFixture();const result=await f.save([{...f.rows.get('own'),name:'新名称',availableQty:888,lockedQty:888,inCatalog:true}])
  assert.equal(result[0].availableQty,5);assert.equal(result[0].lockedQty,2);assert.equal(result[0].inCatalog,false);assert.equal(result[0].name,'新名称')
  assert.equal(f.calls[0],'account-lock');assert.equal(f.rows.get('other').customerId,'c2')
})
test('new records cannot masquerade as catalog entries to bypass uniqueness validation',async()=>{
  const f=productsFixture();const result=await f.save([{id:'new',customerId:'c1',internalSku:'TKL1-B',customerSku:'B',inCatalog:true,availableQty:100}])
  assert.equal(f.skuCalls[0].inCatalog,false);assert.equal(result[0].availableQty,0);assert.equal(result[0].inCatalog,false)
})
test('cross-customer IDs, shared pool ownership and submitted SKU rewrites are rejected',async()=>{
  const f=productsFixture()
  await assert.rejects(f.save([{id:'other',customerId:'c1'}]),/其他客户/)
  await assert.rejects(f.save([{id:'new',customerId:'tkl'}],null),/共享货盘/)
  await assert.rejects(f.save([{...f.rows.get('own'),internalSku:'TKL1-OTHER'}]),/SKU不能更改/)
})
function mirrorFixture() {
  const inventory:any[]=[{id:'old',customerId:'c1',sku:'TKL1-A',warehouse:'jhb1',stockSource:'owned',available:900,locked:901,price:3,ean:'KEEP'},
    {id:'duplicate',customerId:'c1',sku:'TKL1-A',warehouse:'jhb1',stockSource:'owned',available:900,locked:901},
    {id:'stale',customerId:'c1',sku:'TKL1-STALE',warehouse:'jhb1',stockSource:'catalog',available:900,locked:901},
    {id:'other-warehouse',customerId:'c1',sku:'TKL1-A',warehouse:'cpt1',stockSource:'owned',available:7},
    {id:'other-customer',customerId:'c2',sku:'TKL1-A',warehouse:'jhb1',stockSource:'owned',available:7}]
  const products:any[]=[{id:'p',customerId:'c1',internalSku:'TKL1-A',availableQty:900,lockedQty:901,inCatalog:false}]
  const tx:any={inventoryItem:{
    findMany:async({where}:any)=>inventory.filter(i=>i.customerId===where.customerId&&(!where.warehouse||where.warehouse.in.includes(i.warehouse))),
    findUnique:async({where}:any)=>inventory.find(i=>i.id===where.id)||null,
    update:async({where,data}:any)=>Object.assign(inventory.find(i=>i.id===where.id),data),
    upsert:async({where,create,update}:any)=>{const current=inventory.find(i=>i.id===where.id);if(current)Object.assign(current,update);else inventory.push(create)},
  },product:{findMany:async({where}:any)=>products.filter(p=>p.customerId===where.customerId),updateMany:async({where,data}:any)=>products.filter(p=>p.customerId===where.customerId&&p.internalSku===where.internalSku&&p.inCatalog===where.inCatalog).forEach(p=>Object.assign(p,data))}}
  const item:any={id:7,sku:'TKL1-A',productName:'服务端商品',stockSource:'owned',warehouseAvailable:5,warehouseLocked:2,inTransitQty:3,pendingShelvingQty:1,unitPrice:4}
  return {tx,inventory,products,item}
}
test('canonical sync clears duplicate/stale stock and preserves unrelated customer, warehouse and EAN',async()=>{
  const f=mirrorFixture();const result=await applyErpInventoryView(f.tx,'c1','WMS-JHB-01',[f.item])
  assert.equal(f.inventory.find(i=>i.id==='old').available,5);assert.equal(f.inventory.find(i=>i.id==='old').ean,'KEEP')
  for(const id of ['duplicate','stale'])assert.equal(f.inventory.find(i=>i.id===id).available,0)
  for(const id of ['other-warehouse','other-customer'])assert.equal(f.inventory.find(i=>i.id===id).available,7)
  assert.equal(f.products[0].availableQty,5);assert.equal(f.products[0].lockedQty,2);assert.ok(result.inventory.every(i=>i.customerId==='c1'))
})
test('new mirrors use stable bounded scoped IDs; explicit zero values update the same row',async()=>{
  const f=mirrorFixture();await applyErpInventoryView(f.tx,'c1','WMS-JHB-03',[f.item]);await applyErpInventoryView(f.tx,'c1','WMS-JHB-03',[{...f.item,warehouseAvailable:0,warehouseLocked:0}])
  const rows=f.inventory.filter(i=>i.warehouse==='jhb3');assert.equal(rows.length,1);assert.ok(rows[0].id.length<=50);assert.equal(rows[0].available,0)
  assert.equal(f.inventory.find(i=>i.id==='old').available,900)
})
test('invalid ERP quantities or duplicate scope rows reject rather than coercing quantities',async()=>{
  for(const value of ['5',-1,1.5,NaN,2147483648]){const f=mirrorFixture();await assert.rejects(applyErpInventoryView(f.tx,'c1','WMS-JHB-01',[{...f.item,warehouseAvailable:value}]),/数量无效/)}
  const f=mirrorFixture();await assert.rejects(applyErpInventoryView(f.tx,'c1','WMS-JHB-01',[f.item,f.item]),/范围返回异常/)
})
