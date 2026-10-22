import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCatalogReturnSnapshot } from './catalog-return-snapshot.util.js'
test('货盘返库采用绝对持有量，重复推送不叠加且保留在出库数量', async () => {
  const row = { id: 'old', customerId: 'c1', locked: 0, pendingOutbound: 2, available: 0 }
  const prisma = { inventoryItem: { findFirst: async () => row, update: async ({data}:any) => Object.assign(row, data) } }
  for (let i=0;i<2;i++) assert.equal(await applyCatalogReturnSnapshot(prisma as any, 'c1', { sku: 'TKL-A', holdingQty: 2 }, 'jhb1'), true)
  assert.deepEqual(row, { id: 'old', customerId: 'c1', locked: 2, pendingOutbound: 2, available: 0 })
})
test('新的返库持有镜像使用短且稳定标识，不复制共享平台条码', async () => {
  const writes:any[]=[]
  const prisma = { inventoryItem: { findFirst: async () => null, upsert: async (arg:any) => {writes.push(arg)} }, product: { findFirst: async () => ({name:'货盘商品',price:20,image:'',spec:''}) } }
  for(let i=0;i<2;i++) await applyCatalogReturnSnapshot(prisma as any, 'c1', {sku:'TKL-A',holdingQty:1}, 'jhb1')
  assert.equal(writes[0].where.id,writes[1].where.id);assert.ok(writes[0].where.id.length<=50)
  assert.equal(writes[0].create.ean,null);assert.equal(writes[0].create.customerId,'c1');assert.equal(writes[0].create.locked,1)
})
test('缺失镜像的零持有不创建历史空行，无效数量不改库存', async () => {
  let creates=0
  const prisma = { inventoryItem: {findFirst:async()=>null,upsert:async()=>{creates++}} }
  assert.equal(await applyCatalogReturnSnapshot(prisma as any,'c1',{sku:'TKL-A',holdingQty:0},'jhb1'),true)
  for(const qty of [-1,1.5,Infinity,undefined]) assert.equal(await applyCatalogReturnSnapshot(prisma as any,'c1',{sku:'TKL-A',holdingQty:qty},'jhb1'),false)
  assert.equal(creates,0)
})
