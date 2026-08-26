import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator'

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
}

export class AssignPickerDto {
  @IsArray()
  @ArrayMinSize(1)
  @Type(() => Number)
  @IsInt({ each: true })
  ids!: number[]

  @Type(() => Number)
  @IsInt()
  pickerId!: number
}
