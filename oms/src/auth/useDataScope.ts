import { useMemo, useState } from 'react'
import { useRole } from './RoleContext'
import {
  isSysAdmin,
  scopeForRole,
  scopeOutboundForRole,
  scopeProducts,
  getCustomerCode,
} from '../data/dataScope'
import { getPrimaryPlatformBarcode } from '../data/platformBindingUtils'

export function useDataScope() {
  const { role, accounts, customerId, customerCode } = useRole()
  const admin = isSysAdmin(role)
  const [customerFilter, setCustomerFilter] = useState<string>('all')

  const activeCustomerId = admin ? null : customerId
  const activeCustomerCode = admin ? '全平台' : customerCode

  return useMemo(() => ({
    role,
    isAdmin: admin,
    customerFilter,
    setCustomerFilter,
    activeCustomerId,
    activeCustomerCode,
    customerOptions: accounts.filter(a => a.status === 'active'),
    scope: <T extends { customerId?: string }>(items: T[]) =>
      scopeForRole(items, role, admin ? customerFilter : 'all', activeCustomerId),
    scopeOutbound: <T extends { customerId?: string; source?: string }>(items: T[]) =>
      scopeOutboundForRole(items, role, admin ? customerFilter : 'all', activeCustomerId),
    scopeProducts: <T extends {
      customerId?: string
      inCatalog?: boolean
      customCode?: string
      internalSku: string
      productStatus?: string
    }>(items: T[]) =>
      scopeProducts(
        items,
        role,
        admin ? customerFilter : 'all',
        getPrimaryPlatformBarcode,
        activeCustomerId,
      ),
    getCustomerCode: (id?: string) => (
      id && id === activeCustomerId && customerCode
        ? customerCode
        : getCustomerCode(id, accounts)
    ),
  }), [role, admin, customerFilter, accounts, activeCustomerId, activeCustomerCode])
}

export type DataScope = ReturnType<typeof useDataScope>
