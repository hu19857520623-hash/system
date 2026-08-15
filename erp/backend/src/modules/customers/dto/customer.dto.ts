import { Transform, Type } from 'class-transformer'
import {
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'
import {
  OMS_CUSTOMER_TYPES,
  OMS_PORTAL_PERMISSIONS,
  type OmsCustomerType,
  type OmsPortalPermission,
} from '@erp/shared/oms-portal.permissions'

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

const trimOptional = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value
  const normalized = value.trim()
  return normalized || undefined
}

const normalizeEmail = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value
  const normalized = value.trim().toLowerCase()
  return normalized || undefined
}

export class CreateCustomerDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: '客户代码只能包含字母、数字、下划线和短横线' })
  customerCode: string

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  customerName: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(200)
  companyName?: string

  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(120)
  contactEmail?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(50)
  contactName?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(30)
  contactPhone?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1])
  status?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  balance?: number

  /**
   * OMS portal configuration is optional as a group so existing ERP-only
   * callers remain compatible. The provisioning service requires the complete
   * group when any portal field is supplied.
   */
  @IsOptional()
  @IsIn(OMS_CUSTOMER_TYPES)
  portalType?: OmsCustomerType

  /** @deprecated Use portalType. Kept for the existing OMS/ERP clients. */
  @IsOptional()
  @IsIn(OMS_CUSTOMER_TYPES)
  omsType?: OmsCustomerType

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  warehouse?: string

  @IsOptional()
  @IsIn(OMS_CUSTOMER_TYPES)
  permissionTemplate?: OmsCustomerType

  @IsOptional()
  @IsArray()
  @IsIn(OMS_PORTAL_PERMISSIONS, { each: true })
  permissions?: OmsPortalPermission[]

  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(200)
  loginEmail?: string

  @IsOptional()
  @IsString()
  @MinLength(8, { message: '临时密码至少 8 位' })
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: '临时密码必须包含字母和数字',
  })
  temporaryPassword?: string
}

export class UpdateCustomerDto {
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  customerName?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(200)
  companyName?: string

  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(120)
  contactEmail?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(50)
  contactName?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(30)
  contactPhone?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1])
  status?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  balance?: number

  @IsOptional()
  @IsIn(OMS_CUSTOMER_TYPES)
  portalType?: OmsCustomerType

  /** @deprecated Use portalType. Kept for the existing ERP client. */
  @IsOptional()
  @IsIn(OMS_CUSTOMER_TYPES)
  omsType?: OmsCustomerType

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(100)
  warehouse?: string

  @IsOptional()
  @IsIn(OMS_CUSTOMER_TYPES)
  permissionTemplate?: OmsCustomerType

  @IsOptional()
  @IsArray()
  @IsIn(OMS_PORTAL_PERMISSIONS, { each: true })
  permissions?: OmsPortalPermission[]

  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(200)
  loginEmail?: string

  @IsOptional()
  @IsString()
  @MinLength(8, { message: '临时密码至少 8 位' })
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: '临时密码必须包含字母和数字',
  })
  temporaryPassword?: string
}

export class SetPortalTemporaryPasswordDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(200)
  loginEmail: string

  @IsString()
  @MinLength(8, { message: '临时密码至少 8 位' })
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: '临时密码必须包含字母和数字',
  })
  temporaryPassword: string
}

export class InternalSetPortalTemporaryPasswordDto extends SetPortalTemporaryPasswordDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: '客户代码只能包含字母、数字、下划线和短横线' })
  customerCode: string
}
