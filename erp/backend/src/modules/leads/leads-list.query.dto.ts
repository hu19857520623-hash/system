import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString } from 'class-validator'
import { PaginationDto } from '../../common/dto/pagination.dto'

export class LeadsListQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsString()
  statuses?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  assigneeId?: number

  @IsOptional()
  @IsString()
  source?: string

  @IsOptional()
  @IsString()
  followDue?: string

  @IsOptional()
  @IsString()
  dealStatus?: string

  @IsOptional()
  @IsString()
  shopType?: string

  @IsOptional()
  @IsString()
  dealDateFrom?: string

  @IsOptional()
  @IsString()
  dealDateTo?: string

  @IsOptional()
  @IsString()
  createdAtFrom?: string

  @IsOptional()
  @IsString()
  createdAtTo?: string

  @IsOptional()
  @IsString()
  nextFollowAtFrom?: string

  @IsOptional()
  @IsString()
  nextFollowAtTo?: string

  @IsOptional()
  @IsString()
  latestFollowAtFrom?: string

  @IsOptional()
  @IsString()
  latestFollowAtTo?: string

  @IsOptional()
  @IsString()
  followSales?: string
}
