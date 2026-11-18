import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator'
import { PaginationDto } from '../../../common/dto/pagination.dto'
export class CatalogPurchaseQueryDto extends PaginationDto {
  @IsOptional() @IsString() @MaxLength(30) sku?: string
  @IsOptional() @IsString() @MaxLength(30) customerCode?: string
  @IsOptional() @IsString() @MaxLength(100) customerKeyword?: string
  @IsOptional() @IsString() @MaxLength(100) productKeyword?: string
  @IsOptional() @IsString() @MaxLength(50) orderNo?: string
  @IsOptional() @IsIn(['confirmed','pending','cancelled','failed']) status?: string
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '开始日期格式应为YYYY-MM-DD' }) startDate?: string
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '结束日期格式应为YYYY-MM-DD' }) endDate?: string
}
