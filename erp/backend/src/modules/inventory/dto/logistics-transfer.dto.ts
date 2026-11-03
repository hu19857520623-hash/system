import { Type } from 'class-transformer'
import { IsUUID, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator'

export class LogisticsTransferDto {
  @IsOptional()
  @IsUUID('4')
  clientRequestId?: string

  @IsString()
  @IsNotEmpty()
  sku: string

  @IsString()
  @IsNotEmpty()
  fromWarehouseCode: string

  @IsString()
  @IsNotEmpty()
  toWarehouseCode: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  qty: number

  @IsOptional()
  @IsString()
  remark?: string
}
