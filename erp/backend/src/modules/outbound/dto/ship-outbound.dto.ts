import { Transform } from 'class-transformer'
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value
export class ShipOutboundDto {
  @IsUUID('4', { message: '请重新打开发运窗口，使用原操作标识提交' })
  clientRequestId!: string
  @IsOptional() @Transform(trim) @IsString() @MaxLength(50)
  trackingNo?: string
  @IsOptional() @Transform(trim) @IsString() @MaxLength(50)
  carrier?: string
  @IsOptional() @Transform(trim) @IsString() @MaxLength(50)
  logisticsProduct?: string
}
