import { IsInt, Max, Min, ValidateIf } from 'class-validator'

export class CatalogVisibilityDto {
  @IsInt({message:'总可见额度须为整数'}) @Min(0,{message:'总可见额度不可为负数'}) @Max(2147483647,{message:'总可见额度超出范围'})
  visibleStockQty: number

  @ValidateIf((_o,value)=>value!==null)
  @IsInt({message:'请重新读取原可见额度'}) @Min(0,{message:'请重新读取原可见额度'})
  expectedVisibleStockQty: number | null

  @IsInt({message:'请重新读取累计良品实收'}) @Min(0,{message:'请重新读取累计良品实收'})
  expectedReceivedGoodQty: number
}
