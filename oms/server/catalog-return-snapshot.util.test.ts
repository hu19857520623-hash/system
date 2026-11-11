import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCatalogReturnSnapshot } from './catalog-return-snapshot.util.js'

function fixture() {
  const rows:any[]=[{id:'old',customerId:'c1',sku:'TKL-A',locked:0,available:0,pendingOutbound:2,shipped:3},
    {id:'alias',customerId:'c1',sku:'TKL-A',locked:0,available:0,pendingOutbound:1,shipped:4}]
  const calls:string[]=[]
  const tx={$queryRaw:async()=>{calls.push('account-lock');return []},inventoryItem:{
    findMany:async()=>rows,update:async({where,data}:any)=>{calls.push('write');Object.assign(rows.find(row=>row.id===where.id),data)},
    create:async({data}:any)=>{calls.push('create');rows.push(data)},
  }}
  const prisma={$transaction:async(fn:any)=>fn(tx)} as any
  return {rows,calls,prisma}
}
test('退款后晚到的退件通知不复活旧持有，保留历史出库数量',async()=>{
  const f=fixture();f.rows[0].locked=1
  const load=async()=>{f.calls.push('current-source');return []}
  for(let i=0;i<2;i++) assert.equal(await applyCatalogReturnSnapshot(f.prisma,'c1',{sku:'TKL-A',holdingQty:1},load),true)
  assert.equal(f.rows.reduce((sum,row)=>sum+row.locked,0),0)
  assert.deepEqual(f.calls.slice(0,2),['account-lock','current-source'])
  assert.equal(f.rows[0].pendingOutbound,2);assert.equal(f.rows[1].shipped,4)
})
test('旧退件通知不能覆盖后续采购，多个仓库名称只保留一份当前持有',async()=>{
  const f=fixture()
  await applyCatalogReturnSnapshot(f.prisma,'c1',{sku:'TKL-A',holdingQty:1},async()=>[{sku:'TKL-A',quantity:5}])
  assert.deepEqual(f.rows.map(row=>row.locked),[5,0])
})
test('来源故障不把旧事件数量写入库存',async()=>{
  const f=fixture();const before=structuredClone(f.rows)
  await assert.rejects(applyCatalogReturnSnapshot(f.prisma,'c1',{sku:'TKL-A',holdingQty:2},async()=>{throw Error('source unavailable')}))
  assert.deepEqual(f.rows,before);assert.equal(f.calls.includes('write'),false)
})
test('缺失镜像只根据当前来源创建短稳定ID，不复制共享条码，也不新建零持有',async()=>{
  const f=fixture();f.rows.splice(0)
  await applyCatalogReturnSnapshot(f.prisma,'c1',{sku:'TKL-A',holdingQty:1},async()=>[])
  assert.equal(f.rows.length,0)
  await applyCatalogReturnSnapshot(f.prisma,'c1',{sku:'TKL-A',holdingQty:1},async()=>[{sku:'TKL-A',quantity:3,productName:'当前商品',unitPrice:20}])
  assert.equal(f.rows.length,1);assert.equal(f.rows[0].locked,3);assert.equal(f.rows[0].id.length,44);assert.equal(f.rows[0].ean,null)
})
test('无效事件不触发来源读取或写入',async()=>{
  const f=fixture()
  for(const holdingQty of [-1,1.5,Infinity,undefined]) assert.equal(await applyCatalogReturnSnapshot(f.prisma,'c1',{sku:'TKL-A',holdingQty},async()=>{throw Error('must not read')}),false)
  assert.deepEqual(f.calls,[])
})
