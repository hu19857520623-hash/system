import { IsIn, IsNumber, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator'

export class CreateOperatingLedgerDto {
  @IsIn(['income', 'expense'])
  direction!: 'income' | 'expense'

  @IsString()
  @Length(1, 50)
  category!: string

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string

  @IsOptional()
  @IsString()
  @MaxLength(30)
  paymentMethod?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountName?: string

  @IsOptional()
  @IsString()
  @MaxLength(150)
  counterparty?: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  referenceNo?: string

  @IsString()
  occurredOn!: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string
}

export class UpdateOperatingLedgerDto {
  @IsOptional()
  @IsIn(['income', 'expense'])
  direction?: 'income' | 'expense'

  @IsOptional()
  @IsString()
  @Length(1, 50)
  category?: string

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string

  @IsOptional()
  @IsString()
  @MaxLength(30)
  paymentMethod?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountName?: string

  @IsOptional()
  @IsString()
  @MaxLength(150)
  counterparty?: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  referenceNo?: string

  @IsOptional()
  @IsString()
  occurredOn?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string
}
