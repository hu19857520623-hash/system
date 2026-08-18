import { Transform, Type } from 'class-transformer'
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'

const trimOptional = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value
  const normalized = value.trim()
  return normalized || undefined
}

export class CreateOmsProductDto {
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(30)
  customerCode?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(50)
  customerSku?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(50)
  sku?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(50)
  internalSku?: string

  @Transform(({ obj, value }) => {
    const raw = typeof value === 'string' && value.trim()
      ? value
      : typeof obj.name === 'string'
        ? obj.name
        : ''
    return String(raw).trim() || undefined
  })
  @IsString()
  @IsNotEmpty({ message: '请填写商品名称' })
  @MaxLength(200)
  productName!: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(200)
  name?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(200)
  spec?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(80)
  category?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(80)
  brand?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(80)
  barcode?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(80)
  customCode?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(200)
  declaredNameEn?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(200)
  declaredNameCn?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(20)
  unit?: string

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  hasBattery?: boolean

  @IsOptional()
  @IsString()
  @MaxLength(500)
  image?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lengthCm?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  widthCm?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  heightCm?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  weightKg?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  costRmb?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  declaredValue?: number

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(2000)
  remark?: string
}
