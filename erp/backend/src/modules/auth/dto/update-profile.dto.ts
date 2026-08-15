import { IsOptional, IsString, MaxLength } from 'class-validator'

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  realName?: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  email?: string
}
