import { userFacingError } from './user-facing-error'

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type RechargeAttempt = { customerCode: string; customerId?: number; customerName?: string; rechargeNo: string; amount: number; paymentMethod?: string; paymentMethodId?: string; paymentMethodTitle?: string; remark?: string }
const key = (scope: string) => {
  if (!scope) throw new Error('请使用原账号登录后核对充值')
  return `recharge:pending:${scope}`
}
export function newRechargeNo() {
  if (!globalThis.crypto?.getRandomValues) throw new Error('浏览器无法生成充值单号，请更新浏览器后重试')
  const bytes = crypto.getRandomValues(new Uint8Array(14))
  return `RC-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 27)}`
}
export function readRecharge(storage: StoragePort, scope: string): RechargeAttempt | null {
  try {
    const raw = storage.getItem(key(scope)); if (!raw) return null
    const row = JSON.parse(raw)
    if (!row?.customerCode || !/^[A-Za-z0-9_-]{1,30}$/.test(row.rechargeNo) || typeof row.amount !== 'number' || !/^\d+(\.\d{1,2})?$/.test(String(row.amount)) || row.amount <= 0) throw new Error()
    return row
  } catch { throw new Error('原充值核对信息无法读取，请联系财务核对原充值单，勿重新充值') }
}
export function saveRecharge(storage: StoragePort, scope: string, attempt: RechargeAttempt) {
  const previous = readRecharge(storage, scope)
  if (previous && JSON.stringify(previous) !== JSON.stringify(attempt)) throw new Error('还有原充值待核对，请先重试原充值，勿修改金额或更换单号')
  try { storage.setItem(key(scope), JSON.stringify(attempt)) }
  catch { throw new Error('无法保存充值核对信息，本次尚未提交，请检查浏览器存储后重试') }
}
export async function runRecharge<T extends { record: { rechargeNo: string; amount: number }; customerCode: string; balance: number; syncPending?: boolean; warning?: string }>(storage: StoragePort, scope: string, attempt: RechargeAttempt, request: (attempt: RechargeAttempt) => Promise<T>) {
  if (typeof attempt.amount !== 'number' || !/^\d{1,12}(\.\d{1,2})?$/.test(String(attempt.amount)) || attempt.amount <= 0) throw new Error('请输入有效充值金额，最多两位小数')
  saveRecharge(storage, scope, attempt)
  const clear = () => { if (readRecharge(storage, scope)?.rechargeNo === attempt.rechargeNo) storage.removeItem(key(scope)) }
  try {
    const result = await request(attempt)
    if (result.customerCode !== attempt.customerCode || result.record.rechargeNo !== attempt.rechargeNo || result.record.amount !== attempt.amount || !Number.isFinite(result.balance)) throw new Error('充值返回客户、单号或金额不一致')
    if (result.syncPending) return { result, completed: false, message: result.warning || '充值已到账，同步待核对。请重试原充值，勿再次充值' }
    clear()
    return { result, completed: true, message: '充值已到账，请查看最新余额与记录' }
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status)
    if ([400, 404, 422].includes(status)) { clear(); throw new Error(`${userFacingError(error)}。本次未新增充值，请重新核对`) }
    throw new Error(`充值结果待核对，原单已保留。请使用原账号重试原充值，勿另建单。${userFacingError(error)}`)
  }
}
