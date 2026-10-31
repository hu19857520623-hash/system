import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Min, ValidateNested } from 'class-validator'

export class PickAllocationDto {
  @IsString()
  locationCode!: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  qty!: number
}

export class PickLineDto {
  @Type(() => Number)
  @IsInt()
  id!: number

  @IsOptional()
  @IsString()
  locationCode?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pickedQty?: number

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PickAllocationDto)
  allocations?: PickAllocationDto[]
}

export class PickOutboundDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PickLineDto)
  items!: PickLineDto[]

  @IsOptional()
  @IsIn(['pda', 'pick_list'])
  pickSource?: 'pda' | 'pick_list'

  @Matches(/^\S(?:.{0,98}\S)?$/, { message: '缺少或无效的原拣货操作标识，请刷新页面后重试' })
  clientRequestId!: string
}

class AssignmentExpectedOrderDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number

  @IsIn(['pending_pick', 'picking'], { message: '原分配单据状态无效，请刷新后重新选择' })
  status!: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pickerId?: number | null
}

export class AssignPickerDto {
  @Matches(/^\S(?:.{0,98}\S)?$/, { message: '缺少或无效的原分配操作标识，请刷新页面后重试' })
  clientRequestId!: string

  @IsArray({ message: '请提交原分配单据状态' })
  @ArrayMinSize(1, { message: '请提交原分配单据状态' })
  @ValidateNested({ each: true })
  @Type(() => AssignmentExpectedOrderDto)
  expectedOrders!: AssignmentExpectedOrderDto[]

  @IsArray()
  @ArrayMinSize(1)
  @Type(() => Number)
  @IsInt({ each: true })
  ids!: number[]

  @Type(() => Number)
  @IsInt()
  @Min(1)
  pickerId!: number
}
