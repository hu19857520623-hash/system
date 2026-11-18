import { previewCatalogPriceBatch, submitCatalogPriceBatch, catalogPriceBatchReceipt } from './catalog-price-batch.util'
const requestId='97102566-c888-47eb-9eab-0ecdf141f941'
const before={A:10,B:8,C:null,D:null}, after={A:11,B:9,C:7,D:null}
const input={requestId,remark:'批量调价',rows:[{id:1,expectedPrices:before,prices:after},{id:2,expectedPrices:before,prices:after}]}
function fixture(){
 let state:any={products:[1,2].map(id=>({id:BigInt(id),sku:`TKL-${id}`,productName:`商品${id}`,pricingStatus:'synced',finalPrice:10,priceB:8,priceC:null,priceD:null,soldQty:9})),logs:[],history:[],records:[],active:true}, fail=false, queue=Promise.resolve()
 function tables(s:any){return {
  $queryRaw:async()=>[],sysUser:{findUnique:async()=>({status:s.active?1:0,roleCode:'admin'})},
  productPricing:{findMany:async({where}:any)=>s.products.filter((r:any)=>!where.sku || where.sku.in.some((sku:string)=>sku.toLowerCase()===r.sku.toLowerCase())),count:async()=>s.products.length,findUnique:async({where}:any)=>s.products.find((r:any)=>r.id===where.id),update:async({where,data}:any)=>Object.assign(s.products.find((r:any)=>r.id===where.id),data)},
  operationLog:{findFirst:async({where}:any)=>s.logs.find((r:any)=>r.operatorId===where.operatorId&&r.targetId===where.targetId&&r.action===where.action)||null,create:async({data}:any)=>{if(fail)throw Error('audit failed');s.logs.push(data);return data}},
  productPricingHistory:{create:async({data}:any)=>s.history.push(data)},productPriceRecord:{create:async({data}:any)=>s.records.push(data)},
 }}
 const prisma:any={get productPricing(){return tables(state).productPricing},$transaction:(fn:any)=>{const result=queue.then(async()=>{const draft=structuredClone(state);const value=await fn(tables(draft));state=draft;return value});queue=result.then(()=>undefined,()=>undefined);return result}}
 return {prisma,state:()=>state,fail:()=>{fail=true},setPrice:(id:number,price:number)=>{state.products.find((r:any)=>Number(r.id)===id).finalPrice=price}}
}
describe('四档价格批量上传与修改',()=>{
 it('预览按SKU匹配、空白保留、明确null清空，不写库',async()=>{const f=fixture();const old=structuredClone(f.state());const p=await previewCatalogPriceBatch(f.prisma,{rows:[{sku:'1',prices:{B:9,C:null}}]});expect(p).toMatchObject({canSubmit:true,items:[{id:1,sku:'TKL-1',expectedPrices:before,prices:{...before,B:9}}]});expect(f.state()).toEqual(old)})
 it('重复别名、未知SKU及无效价格逐行报错，整批不可提交',async()=>{const f=fixture();const p=await previewCatalogPriceBatch(f.prisma,{rows:[{sku:'1',prices:{A:11}},{sku:'TKL-1',prices:{A:12}},{sku:'missing',prices:{A:1}},{sku:'2',prices:{A:0}}]});expect(p.canSubmit).toBe(false);expect(p.errors.map((r:any)=>r.line)).toEqual([3,4,5]);expect(f.state().history).toHaveLength(0)})
 it('有两个别名商品时拒绝模糊匹配',async()=>{const f=fixture();f.state().products.push({...f.state().products[0],id:3n,sku:'1'});const p=await previewCatalogPriceBatch(f.prisma,{rows:[{sku:'1',prices:{A:11}}]});expect(p.errors[0].message).toContain('多份')})
 it('整批提交同事务更新四档、逐商品审计及汇总回执，不改库存',async()=>{const f=fixture();expect(await submitCatalogPriceBatch(f.prisma,input,7)).toMatchObject({status:'applied',total:2,changed:2});expect(f.state().products.map((r:any)=>[r.finalPrice,r.priceB,r.priceC,r.priceD,r.soldQty])).toEqual([[11,9,7,null,9],[11,9,7,null,9]]);expect(f.state().history).toHaveLength(2);expect(f.state().records).toHaveLength(2);expect(f.state().logs).toHaveLength(1)})
 it('后面商品价格冲突时前面修改也回滚',async()=>{const f=fixture();f.setPrice(2,99);await expect(submitCatalogPriceBatch(f.prisma,input,7)).rejects.toThrow('整批未保存');expect(f.state().products[0].finalPrice).toBe(10);expect(f.state().history).toHaveLength(0)})
 it('汇总审计失败整批回滚',async()=>{const f=fixture();const old=structuredClone(f.state());f.fail();await expect(submitCatalogPriceBatch(f.prisma,input,7)).rejects.toThrow('audit failed');expect(f.state()).toEqual(old)})
 it('并发重试同一批次只写一次，调价后仍返回原回执',async()=>{const f=fixture();const r=await Promise.all([submitCatalogPriceBatch(f.prisma,input,7),submitCatalogPriceBatch(f.prisma,input,7)]);expect(r.map(r=>r.duplicate)).toEqual([false,true]);expect(f.state().history).toHaveLength(2);f.setPrice(1,88);expect(await submitCatalogPriceBatch(f.prisma,input,7)).toMatchObject({status:'applied',duplicate:true});expect(f.state().products[0].finalPrice).toBe(88)})
 it('同一请求标识不允许更换价格或原因',async()=>{const f=fixture();await submitCatalogPriceBatch(f.prisma,input,7);await expect(submitCatalogPriceBatch(f.prisma,{...input,remark:'changed'},7)).rejects.toThrow('内容不同')})
 it('未应用批次取消后，迟到的原提交不能再写价',async()=>{const f=fixture();expect(await catalogPriceBatchReceipt(f.prisma,requestId,7)).toMatchObject({status:'unknown'});expect(await catalogPriceBatchReceipt(f.prisma,requestId,7,true)).toMatchObject({status:'cancelled'});expect(await submitCatalogPriceBatch(f.prisma,input,7)).toMatchObject({status:'cancelled'});expect(f.state().products[0].finalPrice).toBe(10)})
 it('提交抢先完成时取消返回已应用回执，不能假报取消',async()=>{const f=fixture();await submitCatalogPriceBatch(f.prisma,input,7);expect(await catalogPriceBatchReceipt(f.prisma,requestId,7,true)).toMatchObject({status:'applied',changed:2})})
 it('批次回执按操作人隔离',async()=>{const f=fixture();await submitCatalogPriceBatch(f.prisma,input,7);expect(await catalogPriceBatchReceipt(f.prisma,requestId,8)).toMatchObject({status:'unknown'})})
 it('已停用账号不能保存或核对',async()=>{const f=fixture();f.state().active=false;await expect(submitCatalogPriceBatch(f.prisma,input,7)).rejects.toThrow('无货盘定价权限');await expect(catalogPriceBatchReceipt(f.prisma,requestId,7)).rejects.toThrow('无货盘定价权限')})
 it('相同价格原值保存只记批次回执，不重复写价格历史',async()=>{const f=fixture();expect(await submitCatalogPriceBatch(f.prisma,{...input,rows:[{id:1,expectedPrices:before,prices:before}]},7)).toMatchObject({changed:0,unchanged:1});expect(f.state().history).toHaveLength(0)})
 it('拒绝空批次、超500行、重复ID及缺少预览原价',async()=>{const f=fixture();for(const rows of [[],Array(501).fill(input.rows[0]),[input.rows[0],input.rows[0]],[{...input.rows[0],expectedPrices:null}]])await expect(submitCatalogPriceBatch(f.prisma,{...input,rows},7)).rejects.toThrow();expect(f.state().logs).toHaveLength(0)})
})
