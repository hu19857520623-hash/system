import { Transform, Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator'

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value
const numeric = ({ value }: { value: unknown }) => typeof value === 'string' && value.trim() !== '' ? Number(value) : value

class DimensionsDto {
  @IsOptional() @Transform(numeric) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999999.99)
  lengthCm?: number
  @IsOptional() @Transform(numeric) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999999.99)
  widthCm?: number
  @IsOptional() @Transform(numeric) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999999.99)
  heightCm?: number
}

export class ErpShipmentLineDto extends DimensionsDto {
  @Transform(numeric) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  productId!: number
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(30)
  sku!: string
  @Transform(numeric) @IsInt() @Min(1) @Max(2147483647)
  expectedQty!: number
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300)
  productName?: string
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  remark?: string
  @IsOptional() @Transform(numeric) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(9999999.999)
  weightKg?: number
}

export class ShipmentCartonItemDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(30)
  sku!: string
  @Transform(numeric) @IsInt() @Min(1) @Max(2147483647)
  qty!: number
}

export class ShipmentCartonDto extends DimensionsDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(50)
  boxCode?: string
  @IsOptional() @Transform(numeric) @IsInt() @Min(1) @Max(2147483647)
  boxSeq?: number
  @IsOptional() @Transform(numeric) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(9999999.999)
  grossWeightKg?: number
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  remark?: string
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ShipmentCartonItemDto)
  items!: ShipmentCartonItemDto[]
}

export class ShipmentFreightDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(30)
  sku!: string
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300)
  productName?: string
  @IsOptional() @Transform(numeric) @IsInt() @Min(1) @Max(2147483647)
  inboundQty?: number
  @IsOptional() @Transform(numeric) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(99999999.9999)
  seaFreightPerUnit?: number
  @IsOptional() @Transform(numeric) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(99999999.9999)
  domesticFeePerUnit?: number
  @IsOptional() @Transform(numeric) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999.99)
  costRmb?: number
}

export class CreateErpShipmentDto {
  @ValidateIf((row: CreateErpShipmentDto) => !row.inboundNo || row.clientRequestId !== undefined)
  @IsUUID('4', { message: '请提供有效的发运操作标识，重新打开单据后重试' })
  clientRequestId?: string
  @IsOptional() @Transform(trim) @IsString() @MaxLength(30) @Matches(/^[a-z0-9][a-z0-9-]*$/i, { message: '入库单号只能包含字母、数字和连接符' })
  inboundNo?: string
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(30)
  sourceWarehouseCode!: string
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(30)
  warehouseCode!: string
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(30)
  warehouseNo!: string
  @IsOptional() @Transform(trim) @IsString() @MaxLength(50)
  trackingNo?: string
  @IsOptional() @Transform(trim) @IsString() @MaxLength(4000)
  remark?: string
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(30)
  draftNo?: string
  @IsArray() @ArrayMinSize(1, { message: '请填写发运明细' }) @ValidateNested({ each: true }) @Type(() => ErpShipmentLineDto)
  items!: ErpShipmentLineDto[]
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ShipmentCartonDto)
  cartons?: ShipmentCartonDto[]
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ShipmentFreightDto)
  freightLines?: ShipmentFreightDto[]
}

export class SaveInboundDraftDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(30)
  draftNo!: string
  @IsObject({ message: '草稿内容须为有效表单' })
  form!: Record<string, unknown>
}

export class UploadInboundAttachmentDto {
  @IsOptional() @Transform(numeric) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  inboundId?: number
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(30)
  draftNo?: string
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200)
  fileName!: string
  @IsString() @MinLength(1)
  contentBase64!: string
}

export class ShipmentFreightMutationDto {
  @IsUUID('4', { message: '请提供有效的海运费操作标识，重新打开详情后重试' })
  clientRequestId!: string
  @IsString() @Matches(/^[a-f0-9]{64}$/, { message: '请重新读取最新入库单详情后再修改海运费' })
  expectedVersion!: string
}

export class ApplyShipmentFreightDto extends ShipmentFreightMutationDto {
  @IsIn(['lcl', 'fcl'], { message: '请选择拼柜或整柜运输方式' })
  mode!: 'lcl' | 'fcl'
  @Transform(numeric) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(9999999999.99)
  totalAmount!: number
}
