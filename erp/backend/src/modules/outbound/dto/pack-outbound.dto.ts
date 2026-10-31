import { Transform, Type } from 'class-transformer'
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsPositive, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator'

class PackCartonDto {
  @Transform(({ value }) => typeof value === 'string' && value.trim() ? Number(value) : value)
  @IsNumber({}, { message: '箱长须为有效数值' })
  @IsPositive({ message: '箱长须大于零' })
  lengthCm!: number

  @Transform(({ value }) => typeof value === 'string' && value.trim() ? Number(value) : value)
  @IsNumber({}, { message: '箱宽须为有效数值' })
  @IsPositive({ message: '箱宽须大于零' })
  widthCm!: number

  @Transform(({ value }) => typeof value === 'string' && value.trim() ? Number(value) : value)
  @IsNumber({}, { message: '箱高须为有效数值' })
  @IsPositive({ message: '箱高须大于零' })
  heightCm!: number

  @Transform(({ value }) => typeof value === 'string' && value.trim() ? Number(value) : value)
  @IsNumber({}, { message: '箱重须为有效数值' })
  @Min(0, { message: '箱重不能小于零' })
  grossWeightKg!: number
}

export class PackOutboundDto {
  @Matches(/^\S(?:.{0,98}\S)?$/, { message: '缺少或无效的原复核操作标识，请刷新页面后重试' })
  clientRequestId!: string

  @IsOptional()
  @IsBoolean({ message: '打托状态须为是或否' })
  isPalletized?: boolean

  @IsOptional()
  @IsString({ message: '打托资料须为文字' })
  @MaxLength(500, { message: '打托资料不能超过500字' })
  palletInfo?: string

  @IsOptional()
  @IsIn(['pda', 'pick_list'], { message: '复核方式无效' })
  reviewSource?: 'pda' | 'pick_list'

  @IsOptional()
  @IsArray({ message: '请填写外箱尺寸和重量明细' })
  @ValidateNested({ each: true })
  @Type(() => PackCartonDto)
  cartons?: PackCartonDto[]
}
