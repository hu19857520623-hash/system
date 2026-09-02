import { Transform, Type } from 'class-transformer'
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator'

const trimOptional = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value
  const normalized = value.trim()
  return normalized || undefined
}

export class UpsertInboundFeeRuleDto {
  @Transform(trimOptional)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  ruleName!: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customerId?: number | null

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(30)
  warehouseCode?: string | null

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  receiveUnitPrice?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  receiveCartonPrice?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  qcUnitPrice?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  measureUnitPrice?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  labelUnitPrice?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  putawayUnitPrice?: number

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enabled?: boolean

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  effectiveFrom?: string | null

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  effectiveTo?: string | null
}
