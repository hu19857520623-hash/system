import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogBootstrapProducts, customerBootstrapProducts } from '../../server/catalog-bootstrap-products.util.js'
import type { ErpCatalogItem } from '../../server/erpClient.js'
import { calculateOutboundPreDeduct } from './feeTemplates.js'
import { hydrateInventory, getProductsSnapshot } from './inventoryStore.js'

test('直接打开出库或冷刷新时，缺少OMS商品镜像仍按ERP实测尺寸计费', () => {
  const catalog: ErpCatalogItem[]=[20,40].map((length,index)=>({
    sku:`TKL-A${index}`,productName:`商品${index}`,imageUrl:null,spec:null,
    lengthCm:length,widthCm:20,heightCm:20,weightKg:index+1,dimensionsSource:'measured',
    price:40*(index+1),catalogStockPool:3,soldQty:2,remainingStockQty:1,
    visibleOnOms:true,orderableOnOms:true,shareStatus:'enabled',syncedAt:'2026-10-31',
  }))
  try {
    for(let reload=0;reload<2;reload++) {
      const products=customerBootstrapProducts(catalogBootstrapProducts([],catalog,catalog.map(item=>item.sku)),'c1',catalog.map(item=>item.sku))
      hydrateInventory({products,inventory:[],purchases:[]})
      const quote=calculateOutboundPreDeduct(catalog.map(item=>({sku:item.sku,qty:2})),'卡派','jhb',sku=>getProductsSnapshot().find(row=>row.internalSku===sku))
      assert.equal(products.length,2)
      assert.equal(quote.totalVolumeM3,0.048)
      assert.equal(quote.totalWeightKg,6)
    }
  } finally {hydrateInventory({products:[],inventory:[],purchases:[]})}
})
