import { Transform } from 'class-transformer'
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

export class UpsertAnnouncementDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: '请填写公告标题' })
  @MaxLength(200)
  title: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  category?: string

  @Transform(trim)
  @IsString()
  @MinLength(1, { message: '请填写公告正文' })
  content: string

  @IsOptional()
  @IsIn(['erp', 'oms'])
  targetChannel?: 'erp' | 'oms'

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean

  @IsOptional()
  @IsIn(['draft', 'published', 'scheduled'])
  status?: string

  @IsOptional()
  @IsIn(['immediate', 'scheduled'])
  publishMode?: string

  @IsOptional()
  scheduledAt?: string | null

  @IsOptional()
  expiresAt?: string | null
}
