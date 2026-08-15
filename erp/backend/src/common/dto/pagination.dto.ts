import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 20

  @IsOptional()
  @IsString()
  keyword?: string
}

export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/** 将 query 中的 page/pageSize 强制转为整数（URL 参数默认为字符串） */
export function getPagination(q: { page?: unknown; pageSize?: unknown }, defaultPageSize = 20) {
  const page = Math.max(1, parseInt(String(q.page ?? 1), 10) || 1)
  const rawSize = q.pageSize != null && q.pageSize !== '' ? q.pageSize : defaultPageSize
  const pageSize = Math.min(200, Math.max(1, parseInt(String(rawSize), 10) || defaultPageSize))
  return { page, pageSize }
}
