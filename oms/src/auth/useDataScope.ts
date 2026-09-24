import { useMemo, useState } from 'react'
import { useRole } from './RoleContext'
import {
  isSysAdmin,
  scopeForRole,
  scopeInboundForRole,
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
  const bindingCustomerId = admin
    ? (customerFilter !== 'all' ? customerFilter : null)
    : activeCustomerId

  return useMemo(() => ({
    role,
    isAdmin: admin,
    customerFilter,
    setCustomerFilter,
    activeCustomerId,
    bindingCustomerId,
    activeCustomerCode,
    customerOptions: accounts.filter(a => a.status === 'active'),
    scope: <T extends { customerId?: string }>(items: T[]) =>
      scopeForRole(items, role, admin ? customerFilter : 'all', activeCustomerId),
    scopeInbound: <T extends { customerId?: string; inboundType?: string | null; stockSource?: string | null; source?: string | null }>(items: T[]) =>
      scopeInboundForRole(items, role, admin ? customerFilter : 'all', activeCustomerId),
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
        sku => getPrimaryPlatformBarcode(sku, bindingCustomerId ?? undefined),
        activeCustomerId,
      ),
    getCustomerCode: (id?: string) => (
      id && id === activeCustomerId && customerCode
        ? customerCode
        : getCustomerCode(id, accounts)
    ),
  }), [role, admin, customerFilter, accounts, activeCustomerId, bindingCustomerId, activeCustomerCode])
}

export type DataScope = ReturnType<typeof useDataScope>
