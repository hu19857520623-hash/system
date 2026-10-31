import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCatalogReclaimSnapshot } from './catalog-reclaim-snapshot.util.js'
function fixture(locked=5,pendingOutbound=2){
 const row={id:'mirror-c1',customerId:'c1',sku:'TKL-A',stockSource:'catalog',locked,pendingOutbound,shipped:7}
 const reads:any[]=[],writes:any[]=[]
 const tx={$queryRaw:async()=>[],inventoryItem:{findMany:async(arg:any)=>{reads.push(arg);return [row]},update:async({data}:any)=>{writes.push(data);Object.assign(row,data)},create:async(arg:any)=>{writes.push(arg)}}}
 const p={$transaction:async(fn:any)=>fn(tx),product:{update:()=>{throw Error('Do not modify the global catalog product')}}}
 return {row,reads,writes,tx,p:p as any}
}
test('重复收回通知读ERP当前持有量，不按历史事件数量再扣',async()=>{
 const f=fixture();const load=async()=>[{sku:'TKL-A',quantity:3}]
 await applyCatalogReclaimSnapshot(f.p,'c1','TKL-A',load);await applyCatalogReclaimSnapshot(f.p,'c1','TKL-A',load)
 assert.equal(f.row.locked,3);assert.equal(f.row.pendingOutbound,2);assert.equal(f.row.shipped,7)
 assert.deepEqual(f.reads[0],{where:{customerId:'c1',sku:'TKL-A',stockSource:'catalog'},orderBy:{id:'asc'}})
})
test('晚到收回通知不能覆盖后续新采购的持有数量',async()=>{
 const f=fixture();await applyCatalogReclaimSnapshot(f.p,'c1','TKL-A',async()=>[{sku:'TKL-A',quantity:6}]);assert.equal(f.row.locked,6)
})
test('全数收回保留已预约和发货历史，不删除库存镜像',async()=>{
 const f=fixture();await applyCatalogReclaimSnapshot(f.p,'c1','TKL-A',async()=>[]);assert.deepEqual({locked:f.row.locked,pending:f.row.pendingOutbound,shipped:f.row.shipped},{locked:0,pending:2,shipped:7})
})
test('来源失败不猜测库存为零',async()=>{
 const f=fixture();await assert.rejects(applyCatalogReclaimSnapshot(f.p,'c1','TKL-A',async()=>{throw Error('source unavailable')}));assert.equal(f.row.locked,5);assert.equal(f.writes.length,0)
})
test('跨仓库名称的旧镜像只显示一次ERP持有，收回后全部清零且保留历史',async()=>{
 const f=fixture();const other={...f.row,id:'other',locked:8,shipped:4,pendingOutbound:1}
 f.tx.inventoryItem.findMany=async()=>[f.row,other]
 f.tx.inventoryItem.update=async({where,data}:any)=>{f.writes.push(data);Object.assign(where.id===f.row.id?f.row:other,data)}
 await applyCatalogReclaimSnapshot(f.p,'c1','TKL-A',async()=>[{sku:'TKL-A',quantity:3}])
 assert.equal(f.row.locked+other.locked,3)
 await applyCatalogReclaimSnapshot(f.p,'c1','TKL-A',async()=>[])
 assert.equal(f.row.locked+other.locked,0);assert.equal(other.pendingOutbound,1);assert.equal(other.shipped,4);assert.equal(f.row.shipped,7)
})
test('缺失镜像由来源数量补齐，固定短ID，不创建零持有镜像',async()=>{
 const f=fixture();f.tx.inventoryItem.findMany=async()=>[]
 await applyCatalogReclaimSnapshot(f.p,'c1','TKL-A',async()=>[]);assert.equal(f.writes.length,0)
 await applyCatalogReclaimSnapshot(f.p,'c1','TKL-A',async()=>[{sku:'TKL-A',quantity:3,productName:'原商品'}])
 assert.equal(f.writes[0].data.id.length,44);assert.equal(f.writes[0].data.locked,3);assert.equal(f.writes[0].data.available,0)
})
