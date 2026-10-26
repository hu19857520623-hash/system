import { BadRequestException } from '@nestjs/common'

/** Explicit null clears a cap. Invalid input must never silently become an unset cap. */
export function warehouseCapacityInput(value: unknown): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 99999999.9999 || value !== Math.round(value * 10000) / 10000) {
    throw new BadRequestException('仓级上限须为0至99999999.9999的数字，最多4位小数；清空请明确设为空')
  }
  return Math.round(value * 10000) / 10000
}
