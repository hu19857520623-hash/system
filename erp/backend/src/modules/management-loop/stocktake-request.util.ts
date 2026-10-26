import { BadRequestException } from '@nestjs/common'
import { createHash } from 'node:crypto'

export function stocktakeRequestId(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value)) {
    throw new BadRequestException('盘点请求标识缺失或无效，请刷新页面后重新操作')
  }
  return value
}

export function stocktakeFingerprint(payload: unknown) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function stocktakeCountInput(body: any) {
  if (typeof body?.qty !== 'number' || !Number.isSafeInteger(body.qty) || body.qty < 0 || body.qty > 2147483647) {
    throw new BadRequestException('实盘数量必须为非负整数且不能超过系统上限')
  }
  if (!Number.isSafeInteger(body.lineId) || body.lineId <= 0) throw new BadRequestException('请选择有效的盘点明细')
  if (!['pending', 'recount'].includes(body.expectedStage)) throw new BadRequestException('盘点阶段缺失或已变化，请刷新盘点单后继续')
  return { lineId: body.lineId as number, qty: body.qty as number, expectedStage: body.expectedStage as string }
}
