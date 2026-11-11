import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { userFacingError } from '@erp/shared/user-facing-error'
export type RepriceAttempt={actor:string;requestId:string;pricingId:number;name:string;payload:Record<string,unknown>}
type Receipt={requestId:string;status:'unknown'|'confirmed'|'cancelled';pricingId:number;price?:number;version?:string;syncStatus?:string}
export function useRepriceAttempt(options:{actor:()=>string;scope:()=>string|null;conflict?:()=>boolean;storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;request:(mode:'submit'|'check'|'cancel',attempt:RepriceAttempt)=>Promise<Receipt>;applied:(attempt:RepriceAttempt,receipt:Receipt,active:()=>boolean)=>Promise<void>}) {
 const pending=shallowRef<RepriceAttempt|null>(null),busy=ref(false),feedback=ref(''),blocked=ref(false)
 let revision=0,stopped=false
 const key=(actor:string)=>`erp.pricing.reprice.${actor}`
 function valid(a:RepriceAttempt,actor:string){return !(a.actor!==actor||!Number.isSafeInteger(a.pricingId)||a.pricingId<=0||typeof a.name!=='string'||!a.payload||typeof a.payload.price!=='number'||!Number.isFinite(a.payload.price)||a.payload.price<=0||typeof a.payload.expectedUpdatedAt!=='string'||!Number.isFinite(Date.parse(a.payload.expectedUpdatedAt))||typeof a.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(a.requestId))}
 function restore(){
  pending.value=null;busy.value=false;blocked.value=false;feedback.value=''
  const actor=options.actor();if(!actor||!options.scope())return
  try {
   const raw=options.storage.getItem(key(actor));if(!raw)return
   const a=JSON.parse(raw) as RepriceAttempt
   if(!valid(a,actor))throw Error()
   pending.value=a;feedback.value='有原调价结果待核对，请核对、继续原调价或取消原请求，勿重新调价。'
  }catch{blocked.value=true;feedback.value='原调价信息无法读取，请联系管理员核对，勿重新提交。'}
 }
 const stopWatch=watch(options.scope,()=>{++revision;restore()},{immediate:true,flush:'sync'})
 const storageChanged=(event:StorageEvent)=>{if(event.key===null||event.key===key(options.actor())){++revision;restore()}}
 if(typeof window!=='undefined')window.addEventListener('storage',storageChanged)
 onScopeDispose(()=>{stopped=true;++revision;stopWatch();if(typeof window!=='undefined')window.removeEventListener('storage',storageChanged)})
 async function run(mode:'submit'|'check'|'cancel'):Promise<boolean>{
  const a=pending.value,scope=options.scope(),version=revision
  if(stopped||!a||busy.value||blocked.value||!scope||a.actor!==options.actor())return false
  const active=()=>!stopped&&revision===version&&scope===options.scope()&&a.actor===options.actor()
  busy.value=true;feedback.value='正在核对原调价结果…'
  try {
   if(mode==='submit'&&options.conflict?.())throw Error('请先核对或取消其它待处理货盘操作')
   const raw=options.storage.getItem(key(a.actor))
   if(!raw||JSON.stringify(JSON.parse(raw))!==JSON.stringify(a))throw Error('本地原调价记录已变化，请重新加载页面核对')
   const result=await options.request(mode,structuredClone(a));if(!active())return false
   if(result?.requestId!==a.requestId||result.pricingId!==a.pricingId||!['unknown','confirmed','cancelled'].includes(result.status)||result.status==='confirmed'&&(!Number.isFinite(result.price)||Number(result.price)<=0||typeof result.version!=='string'||!Number.isFinite(Date.parse(result.version))||!['recorded','not_required'].includes(result.syncStatus||'')))throw Error('原调价回执不完整，请保留原请求继续核对')
   if(result.status==='unknown'){feedback.value='尚未查到原调价结果，请继续原调价或取消原请求，勿重新创建。';return false}
   await options.applied(a,result,active);if(!active())return false
   if(options.storage.getItem(key(a.actor))!==raw)throw Error('本地原调价记录已变化，请重新加载页面核对')
   options.storage.removeItem(key(a.actor));pending.value=null
   feedback.value=result.status==='cancelled'?'原调价请求已取消，可读取最新定价后重新调整。':`原调价已确认，商品编号${a.pricingId}；列表显示当前最新定价，请核对后继续。`
   return true
  }catch(error){if(active())feedback.value=`原调价已保留。${userFacingError(error)} 请核对结果、继续原调价或取消原请求。`;return false}
  finally{if(active())busy.value=false}
 }
 async function start(pricingId:number,name:string,payload:Record<string,unknown>){
  if(stopped||busy.value||pending.value||blocked.value||!options.scope())return false
  const actor=options.actor(),attempt={actor,requestId:crypto.randomUUID(),pricingId,name,payload:structuredClone(payload)}
  if(!valid(attempt,actor)){feedback.value='定价资料不完整，本次尚未提交，请读取最新定价后继续。';return false}
  try {
   if(options.conflict?.()){feedback.value='请先核对其它待处理货盘操作，本次尚未提交。';return false}
   if(options.storage.getItem(key(actor))){restore();return false}
   const raw=JSON.stringify(attempt);options.storage.setItem(key(actor),raw)
   if(options.storage.getItem(key(actor))!==raw)throw Error()
  }catch{feedback.value='无法保存原调价核对信息，本次尚未提交，请检查浏览器存储后重试。';return false}
  pending.value=attempt;return run('submit')
 }
 function clearFeedback(){if(!pending.value&&!busy.value&&!blocked.value)feedback.value=''}
 return {pending,busy,feedback,blocked,start,run,clearFeedback}
}
