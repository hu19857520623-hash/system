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

/** Includes every mutable count, so a dialog opened before a colleague's submission is stale. */
export function stocktakePlanVersion(plan: any) {
  const canonical = (value: any): any => {
    if (typeof value === 'bigint') return String(value)
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    return value ?? null
  }
  return `st1-${stocktakeFingerprint(canonical({
    id: plan.id, status: plan.status, warehouseCode: plan.warehouseCode, mode: plan.mode,
    blindCount: plan.blindCount, scope: plan.scopeJson, remark: plan.remark,
    lines: [...plan.lines].sort((a, b) => Number(a.id) - Number(b.id)).map(line => ({
      id: line.id, productId: line.productId, locationId: line.locationId, sku: line.sku,
      locationCode: line.locationCode, bookQty: line.bookQty, status: line.status,
      firstQty: line.firstQty, secondQty: line.secondQty, finalQty: line.finalQty, varianceQty: line.varianceQty,
      firstCountedBy: line.firstCountedBy, secondCountedBy: line.secondCountedBy,
    })),
  }))}`
}

export function stocktakeTransitionInput(body: any) {
  if (typeof body?.expectedVersion !== 'string' || !/^st1-[a-f0-9]{64}$/.test(body.expectedVersion)) {
    throw new BadRequestException('盘点版本缺失或无效，请刷新盘点结果后继续')
  }
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 500) {
    throw new BadRequestException('请填写操作原因，最多500字')
  }
  return { expectedVersion: body.expectedVersion as string, reason: body.reason.trim() as string }
}

export function stocktakeCountInput(body: any) {
  if (typeof body?.qty !== 'number' || !Number.isSafeInteger(body.qty) || body.qty < 0 || body.qty > 2147483647) {
    throw new BadRequestException('实盘数量必须为非负整数且不能超过系统上限')
  }
  if (!Number.isSafeInteger(body.lineId) || body.lineId <= 0) throw new BadRequestException('请选择有效的盘点明细')
  if (!['pending', 'recount'].includes(body.expectedStage)) throw new BadRequestException('盘点阶段缺失或已变化，请刷新盘点单后继续')
  return { lineId: body.lineId as number, qty: body.qty as number, expectedStage: body.expectedStage as string }
}
