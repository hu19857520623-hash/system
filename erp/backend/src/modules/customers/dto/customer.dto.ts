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

const normalizeUsername = ({ obj, value }: { obj: Record<string, unknown>; value: unknown }) => {
  const raw = typeof value === 'string' && value.trim()
    ? value
    : typeof obj.loginEmail === 'string'
      ? obj.loginEmail
      : ''
  const normalized = String(raw).trim().toLowerCase()
  return normalized || undefined
}

export const PORTAL_USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/

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
  @Transform(normalizeUsername)
  @IsString()
  @MinLength(6, { message: '登录账号至少 6 位' })
  @MaxLength(50)
  @Matches(PORTAL_USERNAME_PATTERN, {
    message: '登录账号只能包含字母、数字、点、下划线和短横线',
  })
  username?: string

  /** @deprecated Use username. Accepted as an alias for OMS login identity. */
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(200)
  loginEmail?: string

  @IsOptional()
  @IsString()
  @MinLength(6, { message: '临时密码至少 6 位' })
  @MaxLength(128)
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
  @Transform(normalizeUsername)
  @IsString()
  @MinLength(6, { message: '登录账号至少 6 位' })
  @MaxLength(50)
  @Matches(PORTAL_USERNAME_PATTERN, {
    message: '登录账号只能包含字母、数字、点、下划线和短横线',
  })
  username?: string

  /** @deprecated Use username. Accepted as an alias for OMS login identity. */
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(200)
  loginEmail?: string

  @IsOptional()
  @IsString()
  @MinLength(6, { message: '临时密码至少 6 位' })
  @MaxLength(128)
  temporaryPassword?: string
}

export class SetPortalTemporaryPasswordDto {
  @Transform(normalizeUsername)
  @IsString()
  @MinLength(6, { message: '登录账号至少 6 位' })
  @MaxLength(50)
  @Matches(PORTAL_USERNAME_PATTERN, {
    message: '登录账号只能包含字母、数字、点、下划线和短横线',
  })
  username: string

  /** @deprecated Use username. */
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(200)
  loginEmail?: string

  @IsString()
  @MinLength(6, { message: '临时密码至少 6 位' })
  @MaxLength(128)
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

export class RechargeCustomerDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01, { message: '充值金额须大于 0' })
  amount: number

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(30)
  paymentMethod?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(50)
  paymentMethodId?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(100)
  paymentMethodTitle?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(80)
  rechargeNo?: string

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(500)
  remark?: string
}
