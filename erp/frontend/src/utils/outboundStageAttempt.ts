import { userFacingError } from '@erp/shared/user-facing-error'

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type OutboundStage = 'pick' | 'pack' | 'problem' | 'relabel' | 'deliver' | 'assign' | 'cancel' | 'pod'
export type OutboundStageAttempt = {
  outboundId: number
  outboundNo: string
  clientRequestId: string
  payload: Record<string, unknown>
  contentChanged?: boolean
}

const key = (userId: number, stage: OutboundStage) => {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('请使用原账号重新登录后核对出库操作')
  return `erp:outbound-${stage}:${userId}`
}

const bodyOf = (row: OutboundStageAttempt) => JSON.stringify({
  outboundId: row.outboundId,
  outboundNo: row.outboundNo,
  clientRequestId: row.clientRequestId,
  payload: row.payload,
})

export function readStageAttempts(storage: StoragePort, userId: number, stage: OutboundStage): OutboundStageAttempt[] {
  try {
    const text = storage.getItem(key(userId, stage))
    if (!text) return []
    const rows = JSON.parse(text)
    if (!Array.isArray(rows) || rows.some(row => !Number.isSafeInteger(row?.outboundId) || row.outboundId <= 0 || typeof row.outboundNo !== 'string' || typeof row.clientRequestId !== 'string' || !row.payload || typeof row.payload !== 'object')) throw new Error()
    return rows.map(row => { if (row.contentChanged !== true) delete row.contentChanged; return row })
  } catch { throw new Error('原出库操作无法读取，请由主管核对单据，不要另起一次') }
}

export function saveStageAttempt(storage: StoragePort, userId: number, stage: OutboundStage, attempt: OutboundStageAttempt) {
  const rows = readStageAttempts(storage, userId, stage)
  const previous = rows.find(row => row.outboundId === attempt.outboundId)
  if (previous && bodyOf(previous) !== bodyOf(attempt)) throw new Error('此单还有原操作待核对，请先重试原操作，不要修改后提交')
  try { storage.setItem(key(userId, stage), JSON.stringify([...rows.filter(row => row.outboundId !== attempt.outboundId), attempt])) }
  catch { throw new Error('无法保存出库核对信息，本次尚未提交，请检查浏览器存储后重试') }
}

export function clearStageAttempt(storage: StoragePort, userId: number, stage: OutboundStage, attempt: OutboundStageAttempt) {
  const rows = readStageAttempts(storage, userId, stage).filter(row => row.outboundId !== attempt.outboundId || row.clientRequestId !== attempt.clientRequestId)
  if (rows.length) storage.setItem(key(userId, stage), JSON.stringify(rows))
  else storage.removeItem(key(userId, stage))
}

export function stageContentMismatch(message: string) {
  return ['勿修改后重试', '不要修改后重试', '内容不同', '已用于其他内容', '结束本次'].some(part => message.includes(part))
}

export async function runStageAttempt(
  send: (attempt: OutboundStageAttempt) => Promise<unknown>,
  storage: StoragePort,
  userId: number,
  stage: OutboundStage,
  attempt: OutboundStageAttempt,
) {
  const label = stage === 'pick' ? '拣货' : stage === 'pack' ? '复核' : stage === 'relabel' ? '换标' : stage === 'deliver' ? '送达' : stage === 'assign' ? '分配' : stage === 'cancel' ? '取消' : stage === 'pod' ? '签收单' : '标记'
  try {
    const result = await send(attempt)
    clearStageAttempt(storage, userId, stage, attempt)
    return { completed: true, result }
  } catch (error: any) {
    const status = Number(error?.status)
    const detail = String(error?.message || '')
    if (status === 409 && stageContentMismatch(detail)) {
      try { saveStageAttempt(storage, userId, stage, { ...attempt, contentChanged: true }) } catch { /* 原请求仍在，本次页面仍可结束。 */ }
      throw new Error(`原${label}内容不同。请结束本次后再重新填写，不要修改后重试。${userFacingError(error)}`)
    }
    if ([400, 404, 422].includes(status) || status === 409) {
      try { clearStageAttempt(storage, userId, stage, attempt) } catch { throw new Error('原请求已返回结果，但本机核对信息未清除，请由主管核对，不要另起一次') }
      throw new Error(`${userFacingError(error)}。请刷新出库单后按最新状态继续`)
    }
    if (status === 401) throw new Error(`登录已失效，原${label}已保留。请使用原账号重新登录后再重试原操作，不要另起一次。`)
    if (status === 403) throw new Error(`当前岗位无法核对原${label}，原请求已保留。请恢复原岗位权限后再重试，不要更换账号另起一次。`)
    if (status === 429) throw new Error(`请求过于频繁，原${label}已保留。请稍后再重试原操作，不要另起一次。`)
    throw new Error(`原${label}结果尚未确认。请重试原操作，不要另起一次。${userFacingError(error)}`)
  }
}
