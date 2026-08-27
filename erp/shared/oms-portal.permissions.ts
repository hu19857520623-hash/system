export const OMS_CUSTOMER_TYPES = ['ecommerce', 'catalog', 'hybrid'] as const
export type OmsCustomerType = (typeof OMS_CUSTOMER_TYPES)[number]

export const OMS_PORTAL_PERMISSIONS = [
  'dashboard:read',
  'order:read',
  'order:write',
  'order:export',
  'catalog:read',
  'catalog:write',
  'product:read',
  'product:write',
  'code:read',
  'code:apply',
  'code:approve',
  'platform:read',
  'platform:write',
  'inbound:read',
  'inbound:write',
  'outbound:read',
  'outbound:write',
  'inventory:read',
  'logistics:read',
  'returns:read',
  'returns:write',
  'billing:read',
  'billing:recharge',
  'store:manage',
  'report:read',
] as const

export type OmsPortalPermission = (typeof OMS_PORTAL_PERMISSIONS)[number]

export const OMS_PORTAL_PERMISSION_GROUPS: {
  label: string
  permissions: OmsPortalPermission[]
}[] = [
  { label: '看板', permissions: ['dashboard:read'] },
  {
    label: '出库',
    permissions: ['order:read', 'order:write', 'order:export', 'outbound:read', 'outbound:write'],
  },
  { label: '货盘', permissions: ['catalog:read', 'catalog:write'] },
  {
    label: '商品与编码',
    permissions: [
      'product:read',
      'product:write',
      'platform:read',
      'platform:write',
      'code:read',
      'code:apply',
      'code:approve',
    ],
  },
  { label: '入库', permissions: ['inbound:read', 'inbound:write'] },
  { label: '库存', permissions: ['inventory:read'] },
  { label: '物流', permissions: ['logistics:read'] },
  { label: '退件', permissions: ['returns:read', 'returns:write'] },
  { label: '费用', permissions: ['billing:read', 'billing:recharge'] },
  { label: '报表', permissions: ['report:read'] },
]

const ECOMMERCE_PERMISSIONS: OmsPortalPermission[] = [
  'dashboard:read',
  'order:read',
  'order:write',
  'order:export',
  'product:read',
  'product:write',
  'code:read',
  'code:apply',
  'platform:read',
  'platform:write',
  'inbound:read',
  'inbound:write',
  'outbound:read',
  'outbound:write',
  'inventory:read',
  'logistics:read',
  'returns:read',
  'returns:write',
  'billing:read',
  'report:read',
]

const CATALOG_PERMISSIONS: OmsPortalPermission[] = [
  'dashboard:read',
  'catalog:read',
  'catalog:write',
  'product:read',
  'code:read',
  'inbound:read',
  'inbound:write',
  'outbound:read',
  'outbound:write',
  'inventory:read',
  'logistics:read',
  'billing:read',
  'report:read',
]

export const OMS_PERMISSION_TEMPLATES: Record<OmsCustomerType, OmsPortalPermission[]> = {
  ecommerce: ECOMMERCE_PERMISSIONS,
  catalog: CATALOG_PERMISSIONS,
  hybrid: [...new Set([...ECOMMERCE_PERMISSIONS, ...CATALOG_PERMISSIONS])],
}

export function resolveOmsPermissions(
  template: OmsCustomerType | undefined,
  explicit: OmsPortalPermission[] | undefined,
): OmsPortalPermission[] {
  if (explicit) return [...new Set(explicit)]
  return template ? [...OMS_PERMISSION_TEMPLATES[template]] : []
}
