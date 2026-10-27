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

const product = { id:'permission-card',customerId:'permission-customer',internalSku:'TKL9001-PERM41',customerSku:'PERM41',
  name:'隔离只读商品',spec:'',image:'',price:1,cost:1,availableQty:0,lockedQty:0,category:'',categoryPath:'',weight:'1 kg',
  weightKg:1,lengthCm:10,widthCm:10,heightCm:10,inCatalog:false,productStatus:'draft',hasBattery:false,certUploaded:false,
  hasBoxSpec:true,declaredNameEn:'Fixture',declaredNameCn:'隔离只读商品',declaredValue:1,unit:'pcs' } as Product
const storage = () => { const rows=new Map<string,string>();return {getItem:(key:string)=>rows.get(key)||null,setItem:(key:string,value:string)=>rows.set(key,value),removeItem:(key:string)=>rows.delete(key)} }

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
test('dynamic edit routes require write permission before generic product prefixes, including old query URLs',()=>{
  for(const path of ['/products/p/edit','/products/p/edit/','/products/p/edit?from=list','/products/p/edit#section']) {
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
