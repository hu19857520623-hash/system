import { Transform, Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator'

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value
const numeric = ({ value }: { value: unknown }) => typeof value === 'string' && value.trim() !== '' ? Number(value) : value

export class LogisticsReceiptLineDto {
  @Transform(numeric)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  poItemId!: number

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  sku?: string

  @Transform(numeric)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  actualQty!: number

  @IsOptional()
  @Transform(numeric)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  damagedQty?: number

  @IsOptional()
  @IsIn(['pass', 'fail'], { message: '质检结论须为通过或异常' })
  qcStatus?: 'pass' | 'fail'

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  qcRemark?: string
}

export class CreateLogisticsReceiptDto {
  @Transform(numeric)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  poId!: number

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  warehouseCode?: string

  @ValidateIf((row: CreateLogisticsReceiptDto) => !row.receiptNo || row.clientRequestId !== undefined)
  @IsUUID('4', { message: '请提供有效的收货操作标识，重新打开单据后重试' })
  clientRequestId?: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  receiptNo?: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  remark?: string

  @IsArray()
  @ArrayMinSize(1, { message: '请填写收货明细' })
  @ValidateNested({ each: true })
  @Type(() => LogisticsReceiptLineDto)
  items!: LogisticsReceiptLineDto[]
}
