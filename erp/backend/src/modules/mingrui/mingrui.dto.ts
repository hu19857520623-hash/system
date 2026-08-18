import { Transform, Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'
import { PaginationDto } from '../../common/dto/pagination.dto'

const emptyToUndef = ({ value }: { value: unknown }) => {
  if (value == null) return undefined
  if (typeof value === 'string' && !value.trim()) return undefined
  return value
}

export class MingruiListQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  status?: string
}

export class CreateMingruiShipmentDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  poIds?: number[]

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(500)
  poNos?: string

  @IsOptional()
  @IsIn(['lcl', 'fcl'])
  mode?: string

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(30)
  destWarehouse?: string

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(50)
  originCity?: string

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(50)
  destPort?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  packages?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weightKg?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  volumeCbm?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  freightAmount?: number

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  etd?: string

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  eta?: string

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(2000)
  remark?: string

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(50)
  mingruiOrderNo?: string

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(50)
  trackingRef?: string

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  submit?: boolean
}

export class UpdateMingruiShipmentDto {
  @IsOptional()
  @IsIn(['lcl', 'fcl'])
  mode?: string

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(30)
  destWarehouse?: string

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(50)
  originCity?: string

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(50)
  destPort?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  packages?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weightKg?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  volumeCbm?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  freightAmount?: number

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  etd?: string

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  eta?: string

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(100)
  vesselName?: string

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(50)
  blNo?: string

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(50)
  containerNo?: string

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(2000)
  remark?: string
}

export class SyncMingruiQueryDto {
  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(50)
  jobNum?: string

  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(50)
  trackingRef?: string
}
