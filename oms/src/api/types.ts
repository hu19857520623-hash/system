import type { Permission } from '../auth/permissions'

export interface CustomerAccountDto {
  id: string
  name: string
  companyName?: string | null
  code: string
  type: 'ecommerce' | 'catalog' | 'hybrid'
  contact: string
  contactPhone?: string | null
  email: string
  status: 'active' | 'disabled'
  permissions: Permission[]
  warehouse: string
  createdAt: string
  lastLoginAt: string
  portalUser?: {
    loginEmail: string
    status: string
    mustChangePassword: boolean
    lastLoginAt?: string | null
  } | null
  /** @deprecated 请使用 priceTemplateByRegion */
  priceTemplateId?: string | null
  priceTemplateByRegion?: Partial<Record<string, string | null>>
}
