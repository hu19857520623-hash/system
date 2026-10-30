import { onScopeDispose, watch } from 'vue'

/** Keep delayed shipment outcomes attached to their original session and stored intent. */
export function useShipmentRequestScope(options: { actor: () => number; scope: () => string | null; allowed: () => boolean }) {
 let revision = 0, stopped = false
 const invalidate = () => { ++revision }
 const stopWatch = watch(options.scope, invalidate, { flush: 'sync' })
 onScopeDispose(() => { stopped = true; invalidate(); stopWatch() })
 function capture() {
  const owner = options.actor(), scope = options.scope(), version = revision
  const active = () => !stopped && Number.isSafeInteger(owner) && owner > 0 && !!scope && scope === options.scope() && owner === options.actor() && version === revision && options.allowed()
  async function run<A, R>(attempt: A, read: (owner: number) => A | null, request: (original: A) => Promise<R>, apply: (result: R) => Promise<void>) {
   if (!active()) return false
   const saved = JSON.stringify(attempt), original = JSON.parse(saved) as A
   const assertOriginal = () => { if (JSON.stringify(read(owner)) !== saved) throw Error('本地原发运操作记录已变化，请重新读取核对，勿重新提交') }
   assertOriginal()
   const result = await request(original)
   if (!active()) return false
   assertOriginal()
   await apply(result)
   return active()
  }
  return { owner, active, run }
 }
 return { capture, invalidate }
}
