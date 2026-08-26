import { Transform, Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

const trimOptional = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value
  const normalized = value.trim()
  return normalized || undefined
}

export class CreateBillingChargeDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customerId!: number

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: '请填写有效金额' })
  amount!: number

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(30)
  chargeType?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(20)
  source?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(500)
  description?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice?: number

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '收费日期格式为 YYYY-MM-DD' })
  chargeDate?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(30)
  chargeNo?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(100)
  bizRef?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(100)
  sourceRef?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(30)
  warehouseCode?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(30)
  operationType?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(160)
  idempotencyKey?: string

  @IsOptional()
  calcBasis?: Record<string, unknown>

  @IsOptional()
  ruleSnapshot?: Record<string, unknown>

  @IsOptional()
  occurredAt?: string
}

export class GenerateBillingDto {
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '起始日期格式为 YYYY-MM-DD' })
  dateFrom?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '结束日期格式为 YYYY-MM-DD' })
  dateTo?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customerId?: number

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(30)
  customerCode?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(20)
  source?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(30)
  chargeType?: string
}

export class BillingOrderItemDto {
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(30)
  itemType?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(500)
  description?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice?: number

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number
}

export class CreateBillingOrderDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customerId!: number

  @Transform(trim)
  @IsString()
  @MinLength(4)
  @MaxLength(7)
  billingMonth!: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(30)
  billingNo?: string

  @IsArray()
  @ArrayMinSize(1, { message: '请添加账单明细' })
  @ValidateNested({ each: true })
  @Type(() => BillingOrderItemDto)
  items!: BillingOrderItemDto[]
}
