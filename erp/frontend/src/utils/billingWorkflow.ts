import { userFacingError } from '@erp/shared/user-facing-error'
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type BillingAttempt = { kind: 'generate' | 'confirm' | 'manual-charge'; billId?: number; title: string; payload: { clientRequestId: string; [key: string]: any }; snapshot: any }
const key = (userId: number) => {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('请使用原账号重新登录后核对账务操作')
  return `erp:billing-operation:${userId}`
}
export function readBillingAttempt(storage: StoragePort, userId: number): BillingAttempt | null {
  try {
    const raw = storage.getItem(key(userId));if (!raw) return null
    const attempt = JSON.parse(raw)
    if (!['generate', 'confirm', 'manual-charge'].includes(attempt?.kind) || typeof attempt.title !== 'string' || typeof attempt.payload?.clientRequestId !== 'string' || !attempt.snapshot || (attempt.kind === 'confirm' && (!Number.isSafeInteger(attempt.billId) || attempt.billId <= 0))) throw new Error()
    return attempt
  } catch { throw new Error('上次账务操作核对信息无法读取，请联系管理员核对原账单和余额，勿重新扣款') }
}
export function saveBillingAttempt(storage: StoragePort, userId: number, attempt: BillingAttempt) {
  const original = readBillingAttempt(storage, userId)
  if (original && JSON.stringify(original) !== JSON.stringify(attempt)) throw new Error('还有原账务操作待核对，请先使用原请求重试，勿修改金额或重新生成')
  try { storage.setItem(key(userId), JSON.stringify(attempt)) }
  catch { throw new Error('无法保存账务核对信息，本次尚未提交，请检查浏览器存储后重试') }
}
function clearOriginal(storage: StoragePort, userId: number, attempt: BillingAttempt) {
  const current = readBillingAttempt(storage, userId)
  if (current && current.payload.clientRequestId !== attempt.payload.clientRequestId) return
  storage.removeItem(key(userId))
}
export async function runBillingAttempt(api: any, storage: StoragePort, userId: number, attempt: BillingAttempt) {
  try {
    const result = attempt.kind === 'generate' ? await api.generate(attempt.payload) : attempt.kind === 'confirm' ? await api.confirm(attempt.billId, attempt.payload) : await api.createCharge(attempt.payload)
    if (result.syncPending || result.feePending) return { completed: false, result, message: result.warning || '账务操作已保存，OMS同步待核对，请用原操作重试' }
    clearOriginal(storage, userId, attempt)
    return { completed: true, result, message: result.message || '账务操作已保存，请查看最新结果' }
  } catch (error: any) {
    const status = Number(error?.status)
    if ([400, 404, 409, 422].includes(status)) {
      try { clearOriginal(storage, userId, attempt) }
      catch { throw new Error('原操作已返回结果，但核对信息未能清除；请核对原请求，勿重复录入或扣款') }
      throw new Error(`${userFacingError(error)}。请重新核对最新费用和余额后继续`)
    }
    const message = status === 401 ? '登录已失效，原账务请求已保留。请使用原账号重新登录并核对原操作，勿重新扣款'
      : status === 403 ? '当前岗位无法核对原账务操作，原请求已保留。请恢复原岗位权限后重试，勿更换账号重新扣款'
        : `账务结果尚未核实，原请求已保留。请重试原操作，勿重新生成或扣款。${userFacingError(error)}`
    throw new Error(message)
  }
}
export async function loadAllBillingCharges(api: any, filters: any) {
  const snapshot = JSON.parse(JSON.stringify(filters)), rows: any[] = [], ids = new Set<number>()
  let total = 0
  for (let page = 1; page === 1 || rows.length < total; page++) {
    const response = await api.listCharges({ ...snapshot, page, pageSize: 200 })
    const count = Number(response.total)
    if (!Number.isSafeInteger(count) || count < 0 || (page > 1 && count !== total) || !Array.isArray(response.items)) throw new Error('费用范围已变化，请重新核对筛选条件后导出')
    total = count
    if (!response.items.length && rows.length < total) throw new Error('费用读取不完整，请重试导出')
    for (const row of response.items) {
      const id = Number(row.id)
      if (!Number.isSafeInteger(id) || ids.has(id)) throw new Error('费用列表在导出时发生变化，请重新导出')
      ids.add(id);rows.push(row)
    }
    if (rows.length > total) throw new Error('费用范围已变化，请重新导出')
  }
  return rows
}
export const BILLING_CHARGE_LABELS: Record<string, string> = {
  catalog_purchase: '货盘采购', order_fee: '订单处理费', picking: '拣货费', outbound_ship: '出库运费', shipping: '物流费', relabel: '换标', repack: '换箱', handling: '手工作业', storage: '仓储费', inspection: '质检',
  inbound_receipt: '入库收货费', inbound_carton: '入库箱处理费', inbound_qc: '入库清点费', inbound_measure: '入库测量费', inbound_label: '入库贴标费', inbound_putaway: '入库上架费',
  return_receipt: '退件收货费', return_measure: '退件测量费', return_handling: '退件操作费', return_logistics: '退件物流费', return_inspection: '退件质检费', return_destroy: '退件销毁费', return_repack: '退件包装费', return_restock: '退件上架费', return_relabel: '退件换标费', return_extra: '退件附加费', other: '其他费用', wms_outbound: '出库费',
}
