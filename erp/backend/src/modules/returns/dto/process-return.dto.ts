import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator'

export class ReturnRestockLineDto {
  @IsString({ message: '请填写有效的上架 SKU' })
  @MaxLength(50, { message: '上架 SKU 编码过长，请核对商品' })
  sku!: string

  @Type(() => Number)
  @IsInt({ message: '上架数量须为大于零的整数' })
  @Min(1, { message: '上架数量须为大于零的整数' })
  qty!: number

  @IsString({ message: '请填写实际上架库位' })
  @MaxLength(30, { message: '上架库位编码过长，请核对库位' })
  locationCode!: string
}

export class ProcessReturnDto {
  @IsOptional()
  @IsString({ message: '请选择有效的处理结果' })
  @MaxLength(40, { message: '请选择有效的处理结果' })
  processResult?: string

  @IsOptional()
  @IsString({ message: '处理备注须为文字内容' })
  processRemark?: string

  @IsOptional()
  @IsString({ message: '操作标识无效，请刷新退件页面后再操作' })
  @MaxLength(100, { message: '操作标识过长，请关闭弹窗后重新操作' })
  clientRequestId?: string

  @IsOptional()
  @IsString({ message: '请选择实际返库仓库' })
  @MaxLength(30, { message: '返库仓库编码过长，请核对仓库' })
  warehouseCode?: string

  @IsOptional()
  @IsArray({ message: '请填写有效的本次上架明细' })
  @ArrayMinSize(1, { message: '请填写本次上架的 SKU、实际库位和数量' })
  @ValidateNested({ each: true, message: '上架明细格式无效，请核对 SKU、库位和数量' })
  @Type(() => ReturnRestockLineDto)
  stockLines?: ReturnRestockLineDto[]
}
