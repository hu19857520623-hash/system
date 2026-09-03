import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateUserDto {
  @IsString()
  username: string

  @IsString()
  @MinLength(6, { message: '密码至少 6 位' })
  password: string

  @IsString()
  realName: string

  @IsString()
  roleCode: string

  @IsOptional() @IsString() phone?: string
  @IsOptional() @IsString() email?: string
  @IsOptional() @IsString() @MaxLength(30) workstation?: string
  @IsOptional() @IsInt() status?: number
}

export class UpdateUserDto {
  @IsOptional() @IsString() realName?: string
  @IsOptional() @IsString() roleCode?: string
  @IsOptional() @IsString() phone?: string
  @IsOptional() @IsString() email?: string
  @IsOptional() @IsString() @MaxLength(30) workstation?: string
  @IsOptional() @IsInt() status?: number
  @IsOptional() @IsString() @MinLength(6) password?: string
}
