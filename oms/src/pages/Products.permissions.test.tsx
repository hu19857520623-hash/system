import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Routes, Route } from 'react-router-dom'
import { StaticRouter } from 'react-router-dom/server'
import Products from './Products'
import { RoleProvider } from '../auth/RoleContext'
import { storeAuthSession, type AuthSession } from '../api/client'
import { hydrateInventory } from '../data/inventoryStore'
import type { Product } from '../data/mockData'
import type { Permission, OmsRole } from '../auth/permissions'
import { canAccessRoute } from '../auth/permissions'
import type { TestContext } from 'node:test'
import ProductDetail from './ProductDetail'
import ProductForm from '../components/products/ProductForm'
import Layout from '../components/layout/Layout'
import { hydrateBilling } from '../data/billingStore'
import InventoryPage from './Inventory'
import Dashboard from './Dashboard'
import { hydrateEntities } from '../data/entityStore'
import ProductImportPanel from '../components/products/ProductImportPanel'
import { saveProductImportAttempt } from '../data/productImportWorkflow'
import { storeProductSaveAttempt } from '../data/productSaveWorkflow'
import { buildProductAction, storeProductAction, productActionScope } from '../data/productActionWorkflow'

const product = { id:'permission-card',customerId:'permission-customer',internalSku:'TKL9001-PERM41',customerSku:'PERM41',
  name:'隔离只读商品',spec:'',image:'',price:1,cost:1,availableQty:0,lockedQty:0,category:'',categoryPath:'',weight:'1 kg',
  weightKg:1,lengthCm:10,widthCm:10,heightCm:10,inCatalog:false,productStatus:'draft',hasBattery:false,certUploaded:false,
  hasBoxSpec:true,declaredNameEn:'Fixture',declaredNameCn:'隔离只读商品',declaredValue:1,unit:'pcs' } as Product
const storage = () => { const rows=new Map<string,string>();return {getItem:(key:string)=>rows.get(key)||null,setItem:(key:string,value:string)=>rows.set(key,value),removeItem:(key:string)=>rows.delete(key)} }

test('pending lifecycle action survives reload with original labels, partial failures and Chinese recovery choices',t=>{
  environment(t,['product:read','product:write'])
  const actor={id:'readonly',role:'hybrid',customerId:product.customerId!}
  storeProductAction(localStorage,actor,buildProductAction({action:'approve',products:[product],failures:[{sku:'BAD46',error:'请填写英文申报品名'}]},actor))
  const html=render(<Products />)
  for(const label of ['继续原商品操作','核对商品操作结果','取消原商品操作','返回商品列表','BAD46','请填写英文申报品名','下载审核失败明细'])assert.ok(html.includes(label),label)
})

test('unreadable lifecycle action shows Chinese recovery error and return without confirming a replacement',t=>{
  environment(t,['product:read','product:write'])
  const actor={id:'readonly',role:'hybrid',customerId:product.customerId!}
  localStorage.setItem('oms:product-action:'+JSON.stringify([actor.id,productActionScope(actor)]),'{')
  const html=render(<Products />)
  assert.ok(html.includes('原商品操作信息无法读取'));assert.ok(html.includes('返回商品列表'));assert.ok(!html.includes('确认废弃'))
})

test('reviewing product retains an approval entry and is included in the draft count',t=>{
  environment(t,['product:read','product:write'])
  hydrateInventory({inventory:[],products:[{...product,productStatus:'reviewing'}],purchases:[]})
  const html=render(<Products />)
  assert.ok(html.includes('审核中'))
  assert.ok((html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)||[]).some(button=>button.replace(/<[^>]*>/g,'').trim()==='审核'))
  assert.ok(/草稿.*?\(1\)/.test(html))
})

test('unresolved manual save has Chinese check/continue/cancel/return on the form and list',t=>{
  environment(t,['product:read','product:write'])
  storeProductSaveAttempt(localStorage,{requestId:crypto.randomUUID(),userId:'readonly',customerId:product.customerId!,mode:'create',action:'draft',expected:null,product})
  const form=render(<ProductForm mode="create" />),list=render(<Products />)
  for(const label of ['核对原保存结果','继续原保存','取消原保存请求','返回商品列表']) {assert.ok(form.includes(label),label);assert.ok(list.includes(label),label)}
  assert.ok(!form.includes('<input'));assert.ok(!form.includes('保存并提交'))
})
test('unreadable manual save gives a Chinese return path and does not allow a replacement create',t=>{
  environment(t,['product:read','product:write'])
  localStorage.setItem('oms:product-save:'+JSON.stringify(['readonly',product.customerId]),'{')
  const form=render(<ProductForm mode="create" />)
  assert.ok(form.includes('原商品保存信息无法读取'));assert.ok(form.includes('返回商品列表'));assert.ok(!form.includes('<input'))
})

test('unresolved import renders Chinese result/continue/cancel/return controls and preserves failure detail after reload', t=>{
  environment(t,['product:read','product:write'])
  saveProductImportAttempt(localStorage,{requestId:crypto.randomUUID(),userId:'readonly',customerId:product.customerId!,products:[product],rowCount:2,failures:[{lineNo:8,sku:'BAD43',reason:'重量须大于0'}]})
  const html=render(<ProductImportPanel open onOpen={()=>{}} onClose={()=>{}} />)
  for(const text of ['核对结果','继续原批次','取消原批次','返回商品列表','下载失败明细CSV','BAD43','重量须大于0'])assert.ok(html.includes(text),text)
  assert.ok(!html.includes('选择导入文件'))
  const list=render(<Products />);assert.ok(list.includes('核对原导入批次'))
})
test('unreadable batch has a Chinese return path and cannot silently enable a replacement import', t=>{
  environment(t,['product:read','product:write'])
  localStorage.setItem('oms:product-import:'+JSON.stringify(['readonly',product.customerId]),'{')
  const html=render(<ProductImportPanel open onOpen={()=>{}} onClose={()=>{}} />)
  assert.ok(html.includes('原导入批次无法读取'));assert.ok(html.includes('返回商品列表'));assert.ok(!html.includes('选择导入文件'))
})

function environment(t: TestContext, permissions: Permission[], role: OmsRole='hybrid') {
  const descriptors=['localStorage','sessionStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const)
  for(const [key] of descriptors)Object.defineProperty(globalThis,key,{configurable:true,value:storage()})
  t.after(()=>{hydrateInventory({inventory:[],products:[],purchases:[]});for(const [key,value] of descriptors){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key)}})
  storeAuthSession({token:'isolated-render-only',user:{id:'readonly',username:'readonly',email:'',name:'只读客户',role,status:'active',
    customerId:product.customerId,customerCode:'TKL9001',permissions,mustChangePassword:false,type:'hybrid',warehouse:'jhb1'}} as AuthSession)
  hydrateInventory({inventory:[],products:[product,{...product,id:'discarded-card',internalSku:'TKL9001-DISC41',customerSku:'DISC41',productStatus:'discarded'}],purchases:[]})
}
function render(content:ReactNode, location='/products') {
  return renderToStaticMarkup(<StaticRouter location={location}><RoleProvider>{content}</RoleProvider></StaticRouter>)
}
for(const role of ['ecommerce','catalog','hybrid'] as const) test(`${role}: read-only product page retains reads and hides mutation entries`, t=>{
  environment(t,['product:read','inventory:read'],role)
  const html=render(<Products />)
  for(const label of ['创建产品','编辑草稿','废弃商品','永久删除','复制新建','导入商品'])assert.ok(!html.includes(label),label)
  assert.ok(!/>\s*恢复\s*</.test(html))
  for(const label of ['隔离只读商品','打印条码','导出','下载导入模板'])assert.ok(html.includes(label),label)
})
test('writer retains legitimate product maintenance',t=>{
  environment(t,['product:read','product:write'])
  const html=render(<Products />)
  for(const label of ['创建产品','编辑草稿','废弃商品','恢复','永久删除','复制新建','导入商品'])assert.ok(html.includes(label),label)
})
test('administrator retains own-product maintenance while catalog editing points back to ERP',t=>{
  environment(t,[],'sys_admin')
  const html=render(<Products />)
  for(const label of ['创建产品','编辑草稿','废弃商品','恢复','永久删除','复制新建'])assert.ok(html.includes(label),label)
  const blocked=render(<ProductForm product={{...product,inCatalog:true}} mode="edit" />)
  assert.ok(blocked.includes('由ERP维护'));assert.ok(blocked.includes('返回产品详情'));assert.ok(!blocked.includes('<input'))
})
test('create and dynamic edit routes require write before generic product prefixes, including old query URLs',()=>{
  for(const path of ['/products/new','/products/new/','/products/new/?copy=p','/products/p/edit','/products/p/edit/','/products/p/edit?from=list','/products/p/edit#section']) {
    assert.equal(canAccessRoute('hybrid',path,['product:read']),false,path)
    assert.equal(canAccessRoute('hybrid',path,['product:read','product:write']),true,path)
  }
  assert.equal(canAccessRoute('hybrid','/products/p?from=list',['product:read']),true)
})
test('read-only detail preserves its return link and does not offer editing',t=>{
  environment(t,['product:read'])
  const html=render(<Routes><Route path="/products/:id" element={<ProductDetail />} /></Routes>,'/products/permission-card')
  assert.ok(html.includes('返回我的商品'));assert.ok(html.includes('隔离只读商品'));assert.ok(!html.includes('/edit'))
})
test('direct read-only editor renders Chinese return/continue choices without editable fields',t=>{
  environment(t,['product:read'])
  const html=render(<ProductForm product={product} mode="edit" />)
  assert.ok(html.includes('没有商品维护权限'));assert.ok(html.includes('返回我的商品'));assert.ok(html.includes('查看产品详情'))
  assert.ok(!html.includes('<input'));assert.ok(!html.includes('保存并提交'))
})
test('an unauthorized old route cannot render its outlet and returns to an allowed screen',t=>{
  environment(t,['product:read'])
  hydrateBilling({creditBalance:1234,feeRecords:[]})
  t.after(()=>hydrateBilling({creditBalance:0,feeRecords:[]}))
  const html=render(<Routes><Route element={<Layout />}><Route path="/products/:id/edit" element={<p>PRIVATE_EDITOR</p>} /></Route></Routes>,'/products/permission-card/edit')
  assert.ok(html.includes('当前账号无权查看'));assert.ok(html.includes('返回我的商品'));assert.ok(!html.includes('PRIVATE_EDITOR'))
  assert.ok(!html.includes('1,234'));assert.ok(!html.includes('1234'))
})
test('inventory-only page keeps stock but does not offer unavailable outbound history actions',t=>{
  environment(t,['inventory:read','product:read'])
  hydrateInventory({products:[product],purchases:[],inventory:[{id:'i1',customerId:product.customerId,sku:product.internalSku,name:product.name,
    image:'',available:5,locked:0,inTransit:0,pendingShelving:0,pendingOutbound:0,defective:0,shipped:0,safetyStock:0,warningQty:0,
    warehouse:'jhb1',price:1,spec:'',stockSource:'owned'}]})
  const html=render(<InventoryPage />,'/inventory')
  assert.ok(html.includes('仅库存查看'));assert.ok(!html.includes('前往出库记录'));assert.ok(!html.includes('>出库记录<'))
})
test('dashboard permission alone does not display unavailable balances or order counts',t=>{
  environment(t,['dashboard:read']);hydrateBilling({creditBalance:9876,feeRecords:[]})
  hydrateEntities({orders:[],inboundOrders:[],returnOrders:[],stores:[],platformSkuMappings:[],systemMessages:[],announcements:[],billing:null,
    accounts:[{id:product.customerId,name:'隔离客户',code:'TKL9001',contact:'只读联系人',warehouse:'jhb1'}]} as any)
  t.after(()=>hydrateBilling({creditBalance:0,feeRecords:[]}))
  const html=render(<Dashboard />,'/')
  assert.ok(!html.includes('账户余额'));assert.ok(!html.includes('今日订单'));assert.ok(!html.includes('待处理异常'))
  assert.ok(html.includes('待办事项'))
  assert.ok(html.includes('TKL9001'));assert.ok(html.includes('只读联系人'))
})
