import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogBootstrapProducts, customerBootstrapProducts } from './catalog-bootstrap-products.util.js'
import type { ErpCatalogItem } from './erpClient.js'

const catalog: ErpCatalogItem[] = [20,40].map((length,index) => ({
  sku:`TKL-A${index}`, productName:`商品${index}`, imageUrl:null, spec:null,
  lengthCm:length, widthCm:20, heightCm:20, weightKg:index+1, dimensionsSource:'measured',
  price:40*(index+1), catalogStockPool:3, soldQty:2, remainingStockQty:1,
  visibleOnOms:true, orderableOnOms:true, shareStatus:'enabled', syncedAt:'2026-10-31',
}))
test('仅刷新已有镜像尺寸，不改客户归属、持有量、价格或私有商品，也不修改输入', () => {
  const mirror={internalSku:'TKL-A0',customerId:'c1',price:17,availableQty:2,lockedQty:1,lengthCm:10}
  const privateProduct={internalSku:'TKL9069-PRIVATE',customerId:'c1',lengthCm:99}
  const products=catalogBootstrapProducts([mirror,privateProduct],catalog,['TKL-A1'])
  assert.equal(products.length,3)
  assert.deepEqual(products[0],{...mirror,lengthCm:20,widthCm:20,heightCm:20,weightKg:1,weight:'1 kg',hasBoxSpec:true})
  assert.equal(products[1],privateProduct)
  assert.equal(mirror.lengthCm,10)
})
test('停售的已购货盘仍提供发货尺寸，且重复货盘数据不会生成重复档案', () => {
  const stopped={...catalog[0],shareStatus:'stopped' as const,orderableOnOms:false,visibleOnOms:false}
  const result=catalogBootstrapProducts([],[stopped,stopped],[stopped.sku]) as any[]
  assert.equal(result.length,1)
  assert.equal(result[0].weightKg,1)
  assert.equal(result[0].catalogOrderableOnOms,false)
})
test('不因出库依赖商品读取权限而扩展客户无关的货盘目录', () => {
  assert.deepEqual(catalogBootstrapProducts([],catalog),[])
  const result=catalogBootstrapProducts([],catalog,['TKL-A0'])
  assert.deepEqual(result.map(row=>row.internalSku),['TKL-A0'])
})
test('客户作用域保留本人所购货盘元数据，仍排除其它客户私有档案和无关共享商品', () => {
  const own={internalSku:'PRIVATE',customerId:'c1',inCatalog:false}
  const held={internalSku:'TKL-A0',customerId:'tkl',inCatalog:true}
  const foreign={internalSku:'TKL-A0',customerId:'c2',inCatalog:true}
  const unrelated={internalSku:'TKL-A1',customerId:'tkl',inCatalog:true}
  assert.deepEqual(customerBootstrapProducts([own,held,foreign,unrelated],'c1',['TKL-A0']),[own,held])
})
