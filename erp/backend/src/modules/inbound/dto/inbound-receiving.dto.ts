import { Transform, Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator'
const numeric = ({ value }: { value: unknown }) => typeof value === 'string' && value.trim() !== '' ? Number(value) : value
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value

export class InboundReceivingRequestDto {
  @IsUUID('4', { message: '请提供有效的仓库操作标识，重新打开作业页面后重试' })
  clientRequestId!: string
}
export class RecordInboundCartonsDto extends InboundReceivingRequestDto {
  @Transform(numeric) @IsInt() @Min(1) @Max(2147483647)
  receivedCartonCount!: number
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  differenceReason?: string
}
export class ScanInboundCartonDto extends InboundReceivingRequestDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200)
  scanCode!: string
}
export class ScanInboundQcDto extends InboundReceivingRequestDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(4000)
  scanCode!: string
  @IsOptional() @Transform(numeric) @IsInt() @Min(0) @Max(2147483647)
  increment?: number
  @IsOptional() @Transform(numeric) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999999.99)
  lengthCm?: number
  @IsOptional() @Transform(numeric) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999999.99)
  widthCm?: number
  @IsOptional() @Transform(numeric) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999999.99)
  heightCm?: number
  @IsOptional() @Transform(numeric) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(99999.999)
  weightKg?: number
}

export class InboundQcLineDto {
  @Transform(numeric) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  id!: number
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(30)
  sku!: string
  @Transform(numeric) @IsInt() @Min(0) @Max(2147483647)
  actualQty!: number
  @IsIn(['pass', 'fail'], { message: '请选择合格或异常质检结论' })
  qcStatus!: 'pass' | 'fail'
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  qcRemark?: string
  @IsOptional() @Transform(numeric) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999999.99)
  lengthCm?: number
  @IsOptional() @Transform(numeric) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999999.99)
  widthCm?: number
  @IsOptional() @Transform(numeric) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999999.99)
  heightCm?: number
  @IsOptional() @Transform(numeric) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(99999.999)
  weightKg?: number
}

export class SubmitInboundQcDto extends InboundReceivingRequestDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/, { message: '请重新读取最新清点进度后提交' })
  expectedVersion!: string
  @IsOptional() @IsBoolean({ message: '是否接受数量差异须为有效选择' })
  acceptDiff?: boolean
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => InboundQcLineDto)
  items!: InboundQcLineDto[]
}

export class InboundMeasureLineDto {
  @Transform(numeric) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  inboundItemId!: number
  @Transform(numeric) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999999.99)
  lengthCm!: number
  @Transform(numeric) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999999.99)
  widthCm!: number
  @Transform(numeric) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999999.99)
  heightCm!: number
  @IsOptional() @Transform(numeric) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(99999.999)
  weightKg?: number
}
export class MeasureInboundDto extends InboundReceivingRequestDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/, { message: '请重新读取最新测量进度后提交' })
  expectedVersion!: string
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => InboundMeasureLineDto)
  items!: InboundMeasureLineDto[]
}
