import assert from 'node:assert/strict'
import test from 'node:test'
import { createSessionAccessRead } from './sessionAccessRead'

function deferred<T>() { let resolve!: (value:T)=>void, reject!: (error:unknown)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j});return {promise,resolve,reject} }
test('focus, timer and manual refresh share one pending profile read',async()=>{
  const pending=deferred<string>();let reads=0,settled=0;const values:string[]=[]
  const reader=createSessionAccessRead({isCurrent:()=>true,read:()=>{reads++;return pending.promise},apply:value=>values.push(value),error:()=>assert.fail(),settled:()=>settled++})
  const first=reader.refresh();assert.equal(reader.refresh(),first);assert.equal(reader.refresh(),first)
  await Promise.resolve();assert.equal(reads,1);pending.resolve('restricted');await first
  assert.deepEqual(values,['restricted']);assert.equal(settled,1)
})
test('late old-session success, failure and completion cannot update the new login',async()=>{
  for(const fail of [false,true]) {
    const pending=deferred<string>();let owner='old',touched=0
    const reader=createSessionAccessRead({isCurrent:()=>owner==='old',read:()=>pending.promise,apply:()=>touched++,error:()=>touched++,settled:()=>touched++})
    const run=reader.refresh();await Promise.resolve();owner='new'
    if(fail)pending.reject(new Error('old failure'));else pending.resolve('old admin')
    await run;assert.equal(touched,0);await reader.refresh();assert.equal(touched,0)
  }
})
test('failed profile verification can be explicitly retried without replaying a write',async()=>{
  let reads=0,errors=0,settled=0;const values:string[]=[]
  const reader=createSessionAccessRead({isCurrent:()=>true,read:async()=>{if(++reads===1)throw new Error('network');return 'fresh'},apply:v=>values.push(v),error:()=>errors++,settled:()=>settled++})
  await reader.refresh();assert.equal(errors,1);assert.deepEqual(values,[])
  await reader.refresh();assert.deepEqual(values,['fresh']);assert.equal(reads,2);assert.equal(settled,2)
})
test('disposing an owner prevents late responses and future reads',async()=>{
  const pending=deferred<string>();let touched=0
  const reader=createSessionAccessRead({isCurrent:()=>true,read:()=>pending.promise,apply:()=>touched++,error:()=>touched++,settled:()=>touched++})
  const run=reader.refresh();await Promise.resolve();reader.dispose();pending.resolve('stale');await run;await reader.refresh();assert.equal(touched,0)
})
