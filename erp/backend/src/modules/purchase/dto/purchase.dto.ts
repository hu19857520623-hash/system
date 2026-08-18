import { Transform, Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

const trimOptional = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value
  const normalized = value.trim()
  return normalized || undefined
}

export class PurchaseOrderItemDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  productId?: number

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  sku!: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(300)
  productName?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(300)
  name?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  plannedQty?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  qty?: number

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice!: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  domesticFreight?: number

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(500)
  remark?: string
}

export class CreatePurchaseOrderDto {
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(30)
  poNo?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supplierId?: number

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(200)
  supplierName?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(30)
  warehouseCode?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(10)
  currency?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  expectedArrival?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(2000)
  remark?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  domesticFreight?: number

  @ValidateIf((value: CreatePurchaseOrderDto) => !value.lines?.length)
  @IsArray()
  @ArrayMinSize(1, { message: '请添加采购明细' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items?: PurchaseOrderItemDto[]

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  lines?: PurchaseOrderItemDto[]
}

export class PoAuditDto {
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(500)
  remark?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(30)
  warehouseCode?: string
}

export class PoRejectDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: '请填写驳回原因' })
  @MaxLength(500)
  remark!: string
}

export class PaymentRemarkDto {
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(500)
  remark?: string
}

export class AssignPurchaserDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  purchaserId!: number
}

export class CancelPrePurchaseDto {
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(2000)
  reason?: string
}

export class SetActualQtyDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(500)
  remark?: string
}

export class UpdatePrePurchaseDto {
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(30)
  sku?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(300)
  productName?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(100)
  spec?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  plannedQty?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supplierId?: number

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(200)
  supplierName?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(50)
  supplierContactName?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(30)
  supplierContactPhone?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(500)
  supplierAddress?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  domesticFreight?: number

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(30)
  warehouseCode?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(10)
  currency?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  expectedArrival?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(2000)
  remark?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(500)
  productLink?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  accessories?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(500)
  productImageUrl?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(500)
  manualUrl?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(100)
  sampleStatus?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  samplePackageInfo?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(500)
  sampleImageUrl?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  notPurchaseReason?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  moq?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  leadTimeDays?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  spareCartonQty?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  piecesPerCarton?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  taxRate?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  invoiceTaxRate?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  unitTax?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  unitFreight?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  packageWeightKg?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  logoUnitFee?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  logoTotalFee?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  cartonTotalPrice?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  spareCartonUnitPrice?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  productLengthCm?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  productWidthCm?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  productHeightCm?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  packageLengthCm?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  packageWidthCm?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  packageHeightCm?: number

  @IsOptional()
  @IsBoolean()
  doubleLayerCarton?: boolean
}
