import assert from 'node:assert/strict'
import test from 'node:test'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import NegativePurchasePanel from './NegativePurchasePanel'

test('网络错误保留原负申购请求，重开界面后以同一标识重试；明确校验失败允许修改', async () => {
  const originals = ['localStorage','sessionStorage'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)] as const)
  const storage = () => { const m = new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>m.set(k,v),removeItem:(k:string)=>m.delete(k)} }
  for(const key of ['localStorage','sessionStorage']) Object.defineProperty(globalThis,key,{configurable:true,value:storage()})
  const previousFetch=globalThis.fetch, bodies: any[]=[]
  let responseStatus=502, renderer: ReactTestRenderer | undefined
  globalThis.fetch=async (_url,init) => {
    if(init?.method==='POST') { bodies.push(JSON.parse(String(init.body)));return Response.json({error:'测试拒绝'},{status:responseStatus}) }
    return Response.json([])
  }
  const props={customerCode:'C1',writable:true,purchases:[{id:'1',purchaseNo:'P1',customerId:'c1',sku:'TKL-A',productName:'商品',qty:10,totalAmount:100,createdAt:''}]}
  async function mount() { await act(async()=>{renderer=create(<NegativePurchasePanel {...props}/> )}) }
  async function clickSubmit() { const button=renderer!.root.findAllByType('button').find(b=>String(b.props.children).includes('提交负申购') || String(b.props.children).includes('重试核对原申请'))!;await act(async()=>{await button.props.onClick()}) }
  try {
    await mount()
    await act(async()=>{
      renderer!.root.findByProps({'aria-label':'原申购单'}).props.onChange({target:{value:'P1'}})
      renderer!.root.findByProps({'aria-label':'退回数量'}).props.onChange({target:{value:'2'}})
      renderer!.root.findByProps({'aria-label':'退回原因'}).props.onChange({target:{value:'退回'}})
    })
    await clickSubmit();assert.equal(bodies.length,1)
    assert.equal(renderer!.root.findByProps({'aria-label':'退回数量'}).props.disabled,true)
    await act(async()=>{renderer!.unmount()});await mount();await clickSubmit()
    assert.deepEqual(bodies[1],bodies[0]);assert.match(JSON.stringify(renderer!.toJSON()),/原请求已保留/)
    responseStatus=400;await clickSubmit()
    assert.equal(renderer!.root.findByProps({'aria-label':'退回数量'}).props.disabled,false)
    assert.equal(sessionStorage.getItem('oms.negative-purchase.C1'),null)
  } finally {
    await act(async()=>{renderer?.unmount()});globalThis.fetch=previousFetch
    for(const [key,d] of originals) { if(d) Object.defineProperty(globalThis,key,d);else delete (globalThis as any)[key] }
  }
})
