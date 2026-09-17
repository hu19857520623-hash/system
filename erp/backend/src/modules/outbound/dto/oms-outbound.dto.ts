import { Type, Transform } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'
import { normalizeOutboundAttachmentFileType } from '../outbound-label.util'

export class OmsOutboundAttachmentDto {
  @IsOptional()
  @Transform(({ value }) => normalizeOutboundAttachmentFileType(value))
  @IsString()
  @MaxLength(30)
  fileType?: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fileName!: string

  @IsString()
  @IsNotEmpty()
  contentBase64!: string

  @ValidateIf((value) =>
    value.labelRole === 'unitCrop' || value.sku != null || value.unitIndex != null)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  sku?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  platformBarcode?: string

  @ValidateIf((value) =>
    value.labelRole === 'unitCrop' || value.sku != null || value.unitIndex != null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitIndex?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sourcePage?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sourceRow?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sourceColumn?: number

  @IsOptional()
  @IsString()
  @MaxLength(30)
  labelRole?: string

  @IsOptional()
  @IsString()
  @Matches(/^[a-fA-F0-9]{64}$/)
  contentHash?: string
}

export class OmsOutboundItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  sku!: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  qty!: number

  @IsOptional()
  @IsString()
  @MaxLength(300)
  productName?: string

  /** 该 SKU 是否需要仓库换标；不传则按需换标处理（兼容旧客户端） */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true' || value === 1 || value === '1') return true
    if (value === false || value === 'false' || value === 0 || value === '0') return false
    return value
  })
  @IsBoolean()
  needsRelabel?: boolean
}

export class CreateOmsOutboundDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  outboundNo?: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  customerCode!: string

  @IsOptional()
  @IsString()
  @MaxLength(30)
  warehouseCode?: string

  @IsOptional()
  @IsString()
  @MaxLength(30)
  platform?: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  fbaNo?: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  poNumber?: string

  @IsOptional()
  @IsString()
  appointmentDate?: string

  @IsOptional()
  @IsString()
  shipmentDueDate?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sellerStoreName?: string

  @IsOptional()
  @IsString()
  @MaxLength(30)
  takealotSellerId?: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  takealotBookingRef?: string

  @IsOptional()
  @IsString()
  remark?: string

  @IsOptional()
  @IsIn(['catalog', 'owned'])
  stockSource?: 'catalog' | 'owned'

  @IsOptional()
  @IsString()
  @MaxLength(20)
  destType?: string

  @IsOptional()
  @IsString()
  @MaxLength(30)
  fbaWarehouse?: string

  @IsOptional()
  @IsString()
  shippingMethod?: string

  @IsOptional()
  @IsString()
  destination?: string

  @IsOptional()
  @IsString()
  source?: string

  @IsOptional()
  @IsString()
  orderNo?: string

  @IsOptional()
  @IsObject()
  recipient?: {
    name: string
    province?: string
    city: string
    postalCode: string
    phone: string
    address1: string
    address2?: string
    email?: string
  }

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OmsOutboundItemDto)
  items!: OmsOutboundItemDto[]

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OmsOutboundAttachmentDto)
  attachments?: OmsOutboundAttachmentDto[]

  @IsOptional()
  @IsObject()
  preDeduct?: {
    destRegion?: string
    priceTemplateId?: string
    priceTemplateName?: string
    preDeductTotal: number
    totalVolumeM3?: number
    totalWeightKg?: number
    lines: { type: string; label: string; amount: number; detail?: string }[]
    deductedAt?: string
    templateSnapshot?: {
      handling: { perOrderBase: number; perUnit: number; perSkuLine: number }
      shipping: {
        mode: 'volume' | 'weight'
        ratePerCbm?: number
        ratePerKg?: number
        minCharge: number
      }
      pickup?: { perOrder: number; perUnit: number; minCharge: number }
      shippingMethod: string
      destRegion: string
    }
  }
}
