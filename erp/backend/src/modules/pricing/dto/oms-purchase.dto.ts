import { Transform } from 'class-transformer'
import { IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator'
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value
export class OmsPurchaseDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(50)
  orderNo!: string
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(30)
  sku!: string
  @IsInt() @Min(1)
  quantity!: number
  @IsOptional() @IsInt() @Min(1)
  customerId?: number
  @IsOptional() @Transform(trim) @IsString() @MaxLength(30)
  customerCode?: string
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01)
  unitPrice?: number
}
