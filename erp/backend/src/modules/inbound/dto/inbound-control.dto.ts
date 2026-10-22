import { Transform } from 'class-transformer'
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator'
import { InboundReceivingRequestDto } from './inbound-receiving.dto'
const numeric = ({ value }: { value: unknown }) => typeof value === 'string' && value.trim() ? Number(value) : value
export class InboundControlDto extends InboundReceivingRequestDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/, { message: '请重新读取最新单据后处理' })
  expectedVersion!: string
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(2) @MaxLength(500)
  reason!: string
  @IsOptional() @Transform(numeric) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  inboundItemId?: number
  @IsOptional() @Transform(numeric) @IsInt() @Min(1) @Max(2147483647)
  quantity?: number
  @IsOptional() @Transform(numeric) @IsInt() @Min(0) @Max(2147483647)
  expectedCurrent?: number
}
