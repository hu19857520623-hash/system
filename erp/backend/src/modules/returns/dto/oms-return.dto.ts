import { Type } from 'class-transformer'
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export class OmsReturnItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  sku!: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number

  @IsOptional()
  @IsString()
  @MaxLength(300)
  productName?: string
}

export class OmsReturnAttachmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  fileType?: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fileName!: string

  @IsOptional()
  @IsString()
  contentBase64?: string

  @IsOptional()
  @IsString()
  url?: string
}

export class CreateOmsReturnDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  returnNo?: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  customerCode!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  orderNo!: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  referenceNo?: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  trackingNo?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sellerStoreName?: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sellerTaxNo?: string

  @IsOptional()
  @IsString()
  @MaxLength(20)
  returnWarehouse?: string

  @IsOptional()
  @IsString()
  expectedArrivalAt?: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  returnReason!: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  returnDescription?: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  requestedProcess!: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remark?: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OmsReturnItemDto)
  items!: OmsReturnItemDto[]

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OmsReturnAttachmentDto)
  attachments?: OmsReturnAttachmentDto[]
}
