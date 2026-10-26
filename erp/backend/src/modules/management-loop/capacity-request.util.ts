import { BadRequestException } from '@nestjs/common'

export function capacityRequestId(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value)) throw new BadRequestException('容量刷新请求标识缺失或无效，请刷新页面后继续')
  return value
}

export function capacityWarehouseCode(value: unknown) {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 30) throw new BadRequestException('请选择有效的海外仓')
  return value.trim()
}

export function capacityPendingQty(status: string, item: { expectedQty: number; actualQty?: number | null; putawayQty?: number | null }) {
  const expected = status === 'pending_putaway' ? item.actualQty ?? item.expectedQty : item.expectedQty
  return Math.max(0, expected - (item.putawayQty ?? 0))
}
