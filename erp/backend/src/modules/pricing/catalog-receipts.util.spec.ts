import { catalogReceiptTotals, withCatalogReceiptCaps } from './catalog-receipts.util'
import { catalogStockPool, receivedCatalogQtyPatch, remainingCatalogStock } from './catalog-stock.util'
import { toCatalogInternalSku } from '../../common/catalog-customer.util'

const receipt=(no:string,quantity:number,extra:any={})=>({inboundNo:no,status:'completed',sourceWarehouseCode:'LW-SZ-01',omsCustomerCode:null,items:[{sku:'A',actualQty:quantity,expectedQty:99,qcStatus:'pass'}],...extra})
const fixture=(orders:any[])=>({inboundOrder:{findMany:jest.fn().mockResolvedValue(orders)},product:{findMany:jest.fn().mockResolvedValue([...new Set(orders.flatMap(order=>order.items.map((item:any)=>item.sku)))].map((sku,id)=>({id:BigInt(id+1),sku})))}})
describe('累计良品实收的货盘额度',()=>{
  it('累计旧6与新2为8，同时保留最新批次2供本批信息使用',async()=>{
    const db=fixture([receipt('OLD',6),receipt('NEW',2)]),r=await catalogReceiptTotals(db,[{sku:'TKL-A',inboundNo:'NEW'}])
    expect(r.totals.get('TKL-A')).toBe(8);expect(r.batches.get('NEW')?.get('TKL-A')).toBe(2)
    expect(receivedCatalogQtyPatch({inboundQty:2,visibleStockQty:8},2,8)).toBeNull()
  })
  it('本批短收时可见额度按累计实收限额，不能只压成最新批次',()=>{
    expect(receivedCatalogQtyPatch({inboundQty:20,visibleStockQty:26},2,8)).toEqual({inboundQty:2,visibleStockQty:8})
    expect(receivedCatalogQtyPatch({inboundQty:20,visibleStockQty:3},2,8)).toEqual({inboundQty:2})
  })
  it('排除质检异常行、未完结在途、作废及OMS客户入库',async()=>{
    const db=fixture([receipt('OLD',6),receipt('NEW',2,{items:[{sku:'A',actualQty:2,qcStatus:'pass'},{sku:'A',actualQty:2,qcStatus:'fail'}]}),receipt('TRANSIT',99,{status:'pending_receipt'}),receipt('VOID',30,{status:'cancelled'}),receipt('OMS',88,{omsCustomerCode:'TKL9001'}),receipt('NO-SOURCE',77,{sourceWarehouseCode:null,poId:null})])
    const [r]=await withCatalogReceiptCaps(db,[{sku:'TKL-A',inboundNo:'NEW'}]);expect(r.receivedGoodQty).toBe(8)
  })
  it('仓内发货不改变累计实收，已售独立扣除且不改运营较低额度',async()=>{
    const db=fixture([receipt('OLD',6),receipt('NEW',2)]),[low,high]=await withCatalogReceiptCaps(db,[{sku:'TKL-A',visibleStockQty:3,inboundQty:2,soldQty:2},{sku:'TKL-A',visibleStockQty:20,inboundQty:2,soldQty:2}])
    expect(catalogStockPool(low)).toBe(3);expect(remainingCatalogStock(low)).toBe(1)
    expect(catalogStockPool(high)).toBe(8);expect(remainingCatalogStock(high)).toBe(6)
  })
  it('未设置总额度时使用累计实收，不退回最新批次数量或采购数量',async()=>{
    const db=fixture([receipt('OLD',6),receipt('NEW',2)]),[row]=await withCatalogReceiptCaps(db,[{sku:'TKL-A',visibleStockQty:null,inboundQty:2,purchaseQty:999,soldQty:2}])
    expect(catalogStockPool(row)).toBe(8);expect(remainingCatalogStock(row)).toBe(6)
  })
  it('没有已实收凭据时上限为0，不把ASN预期或当前仓存猜成可售池',async()=>{
    const [r]=await withCatalogReceiptCaps(fixture([]),[{sku:'TKL-A',visibleStockQty:99,inboundQty:99}]);expect(catalogStockPool(r)).toBe(0)
    const [zero]=await withCatalogReceiptCaps(fixture([receipt('ZERO',0)]),[{sku:'TKL-A'}]);expect(zero.receivedGoodQty).toBe(0)
  })
  it('合并同SKU多明细与别名，不因请求重复别名把实收重复计入',async()=>{
    const db=fixture([receipt('MIX',0,{items:[{sku:'A',actualQty:6,qcStatus:'pass'},{sku:'TKL-A',actualQty:2,qcStatus:'pass'},{sku:'B',actualQty:99,qcStatus:'pass'}]})])
    const rows=await withCatalogReceiptCaps(db,[{sku:'A'},{sku:'TKL-A'}]);expect(rows.map(r=>r.receivedGoodQty)).toEqual([8,8])
  })
  it('通过入库单解析被缩短的长SKU，再查询相同源商品的所有批次',async()=>{
    const source='LONG-PRODUCT-CODE-0123456789-ABC',internal=toCatalogInternalSku(source)
    const db=fixture([receipt('OLD',1,{items:[{sku:source,actualQty:6,qcStatus:'pass'}]}),receipt('NEW',1,{items:[{sku:source,actualQty:2,qcStatus:'pass'}]})])
    expect((await withCatalogReceiptCaps(db,[{sku:internal,inboundNo:'NEW'}]))[0].receivedGoodQty).toBe(8)
    expect(db.inboundOrder.findMany.mock.calls[1][0].where.items.some.sku.in).toContain(source)
  })
  it('已完结历史单保留真实实收，不用预期数替代缺失实收',async()=>{
    const db=fixture([receipt('LEGACY',4,{status:'confirmed',items:[{sku:'A',actualQty:4,qcStatus:null},{sku:'A',actualQty:null,qcStatus:null}]})])
    expect((await withCatalogReceiptCaps(db,[{sku:'TKL-A'}]))[0].receivedGoodQty).toBe(4)
  })
  it('按ERP商品档案确认归属，普通SKU前缀不冒充客户，OMS私有档案不进入总池',async()=>{
    const db=fixture([receipt('MIX',0,{items:[{sku:'FUR-CABINET',productId:1n,actualQty:6,qcStatus:'pass'},{sku:'FUR-CABINET',productId:2n,actualQty:20,qcStatus:'pass'}]})])
    db.product.findMany.mockResolvedValue([{id:1n,sku:'FUR-CABINET'}])
    expect((await withCatalogReceiptCaps(db,[{sku:'TKL-FUR-CABINET'}]))[0].receivedGoodQty).toBe(6)
    expect(db.product.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({AND:expect.any(Array)})}))
  })
  it.each([-1,1.5,2147483648])('异常实收%s不会变成可售额度',async actualQty=>{
    await expect(withCatalogReceiptCaps(fixture([receipt('BAD',actualQty)]),[{sku:'TKL-A'}])).rejects.toThrow('累计良品实收数量')
  })
})
