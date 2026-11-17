import { Type } from 'class-transformer'
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
import { PaginationDto } from '../../../common/dto/pagination.dto'
export class RechargeRecordQueryDto extends PaginationDto {
  @IsOptional() @IsString() @MaxLength(100) keyword?: string
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) customerId?: number
  @IsOptional() @IsString() @MaxLength(100) customerKeyword?: string
  @IsOptional() @IsString() @MaxLength(50) rechargeNo?: string
  @IsOptional() @IsString() @MaxLength(20) paymentMethod?: string
  @IsOptional() @IsIn(['confirmed','pending','cancelled','failed']) status?: string
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate?: string
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate?: string
  @IsOptional() @Type(()=>Number) @IsNumber({maxDecimalPlaces:2}) @Min(0) @Max(999999999999.99) minAmount?: number
  @IsOptional() @Type(()=>Number) @IsNumber({maxDecimalPlaces:2}) @Min(0) @Max(999999999999.99) maxAmount?: number
}
