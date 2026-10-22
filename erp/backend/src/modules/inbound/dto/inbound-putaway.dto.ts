import { Transform, Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator'
import { InboundReceivingRequestDto } from './inbound-receiving.dto'
const numberInput = ({ value }: { value: unknown }) => typeof value === 'string' && value.trim() ? Number(value) : value
export class InboundPutawayLocationDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString() @MinLength(1) @MaxLength(30)
  locationCode!: string
  @Transform(numberInput) @IsInt() @Min(1) @Max(2147483647)
  qty!: number
}
export class InboundPutawayLineDto {
  @Transform(numberInput) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  inboundItemId!: number
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => InboundPutawayLocationDto)
  lines!: InboundPutawayLocationDto[]
}
export class PutawayInboundDto extends InboundReceivingRequestDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/, { message: '请重新读取最新实收与测量进度后上架' })
  expectedVersion!: string
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => InboundPutawayLineDto)
  items!: InboundPutawayLineDto[]
}
