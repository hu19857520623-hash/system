import { Type } from 'class-transformer'
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
  IsUUID,
  Matches,
  IsIn,
  IsObject,
} from 'class-validator'

export class OmsAsnOriginalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  customerCode!: string

  @IsIn(['create', 'update', 'reactivate', 'cancel'])
  kind!: 'create' | 'update' | 'reactivate' | 'cancel'

  @IsObject()
  original!: Record<string, unknown>
}

export class OmsAsnItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  sku!: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  qty!: number

  @IsOptional()
  @IsString()
  @MaxLength(300)
  productName?: string

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  boxNo?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  lengthCm?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  widthCm?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  heightCm?: number
}

export class OmsAsnAttachmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fileName!: string

  @IsString()
  @IsNotEmpty()
  contentBase64!: string

  @IsOptional()
  @IsString()
  @MaxLength(30)
  fileType?: string
}

export class CreateOmsAsnDto {
  @IsOptional()
  @IsUUID('4')
  clientRequestId?: string

  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/)
  expectedVersion?: string
  @IsOptional()
  @IsString()
  @MaxLength(40)
  inboundNo?: string

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
  @MaxLength(80)
  trackingNo?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remark?: string

  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string

  @IsOptional()
  @IsString()
  @MaxLength(40)
  inboundType?: string

  @IsOptional()
  @IsString()
  @MaxLength(40)
  deliveryMethod?: string

  @IsOptional()
  @IsString()
  @MaxLength(40)
  stockSource?: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  referenceNo?: string

  @IsOptional()
  @IsString()
  eta?: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  contact?: string

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OmsAsnItemDto)
  items!: OmsAsnItemDto[]

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OmsAsnAttachmentDto)
  attachments?: OmsAsnAttachmentDto[]
}

export class CancelOmsAsnDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  customerCode!: string

  @IsUUID('4')
  clientRequestId!: string

  @Matches(/^[a-f0-9]{64}$/)
  expectedVersion!: string
}
