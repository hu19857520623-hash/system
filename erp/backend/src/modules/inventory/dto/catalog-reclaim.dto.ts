import { Transform, Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator'
import { PaginationDto } from '../../../common/dto/pagination.dto'
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value
export class CatalogReclaimHistoryQueryDto extends PaginationDto {
  @IsOptional() @Transform(trim) @IsString({ message: '客户代码须为文字' }) @MaxLength(30, { message: '客户代码最多30位' })
  customerCode?: string

  @IsOptional() @Transform(trim) @IsString({ message: '商品编码须为文字' }) @MaxLength(30, { message: '商品编码最多30位' })
  sku?: string
}
export class CatalogReclaimPreviewDto {
  @Transform(trim)
  @IsString({ message: '请填写客户代码' })
  @MinLength(1, { message: '请填写客户代码' })
  @MaxLength(30, { message: '客户代码最多30位' })
  customerCode: string

  @Transform(trim)
  @IsString({ message: '请填写商品编码' })
  @MinLength(1, { message: '请填写商品编码' })
  @MaxLength(30, { message: '商品编码最多30位' })
  sku: string
}

export class CatalogRefundAllocationDto {
  @IsInt({ message: '请选择有效的原购买单' })
  @Min(1, { message: '请选择有效的原购买单' })
  orderId: number

  @IsInt({ message: '各购买单退款数量须为正整数' })
  @Min(1, { message: '各购买单退款数量须为正整数' })
  @Max(2147483647, { message: '各购买单退款数量超出范围' })
  quantity: number
}

export class CatalogReclaimDto extends CatalogReclaimPreviewDto {
  @IsUUID('4', { message: '请保留原收回请求标识后重试' })
  clientRequestId: string

  @IsInt({ message: '收回数量须为正整数' })
  @Min(1, { message: '收回数量须为正整数' })
  @Max(2147483647, { message: '收回数量超出支持范围' })
  quantity: number

  @IsArray({ message: '请选择退款对应的原购买记录' })
  @ArrayMinSize(1, { message: '请选择退款对应的原购买记录' })
  @ArrayMaxSize(100, { message: '每次最多核对100笔原购买记录' })
  @ValidateNested({ each: true })
  @Type(() => CatalogRefundAllocationDto)
  allocations: CatalogRefundAllocationDto[]

  @IsNumber({ maxDecimalPlaces: 2 }, { message: '请重新核对原购买单的退款金额' })
  @Min(0.01, { message: '请重新核对原购买单的退款金额' })
  expectedRefundAmount: number

  @IsOptional()
  @Transform(trim)
  @IsString({ message: '收回备注须为文字' })
  @MaxLength(500, { message: '收回备注最多500字' })
  remark?: string
}
