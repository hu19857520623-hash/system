export type OmsRole = 'sys_admin' | 'ecommerce' | 'catalog' | 'hybrid'

export type CustomerAccountType = 'ecommerce' | 'catalog' | 'hybrid'

export type AccountStatus = 'active' | 'disabled'

export type Permission =
  | 'dashboard:read'
  | 'order:read' | 'order:write' | 'order:export'
  | 'catalog:read' | 'catalog:write'
  | 'product:read' | 'product:write'
  | 'code:read' | 'code:apply' | 'code:approve'
  | 'platform:read' | 'platform:write'
  | 'inbound:read' | 'inbound:write'
  | 'outbound:read' | 'outbound:write'
  | 'inventory:read'
  | 'logistics:read'
  | 'returns:read' | 'returns:write'
  | 'billing:read' | 'billing:recharge'
  | 'store:manage'
  | 'report:read'
  | 'account:manage' | 'account:disable' | 'account:assign'

export const ROLE_LABELS: Record<OmsRole, string> = {
  sys_admin: '系统管理员',
  ecommerce: '电商客户',
  catalog: '货盘客户',
  hybrid: '混合客户',
}

export const ROLE_DESCRIPTIONS: Record<OmsRole, string> = {
  sys_admin: '统一管理客户账号、分配权限、启用/禁用账号',
  ecommerce: '自有电商履约：平台订单同步后在 OMS 预约发货',
  catalog: '货盘分销：在 OMS 选品购货后预约发货',
  hybrid: '电商 + 货盘双业务：平台订单与货盘分销均可预约发货',
}

export const ACCOUNT_TYPE_LABELS: Record<CustomerAccountType, string> = {
  ecommerce: '电商客户',
  catalog: '货盘客户',
  hybrid: '混合客户（电商+货盘）',
}

/** 客户业务升级路径（管理员操作，无需新建账号） */
export const ACCOUNT_UPGRADE_PATHS: {
  from: CustomerAccountType
  to: CustomerAccountType
  label: string
  steps: string[]
}[] = [
  {
    from: 'catalog',
    to: 'hybrid',
    label: '货盘客户 → 混合客户（开通电商）',
    steps: [
      '账号类型改为「混合客户」',
      '套用混合模板，或追加：订单、店铺、商品写入、退件等权限',
      '客户绑定 Takealot / Shopify 店铺',
      '历史货盘库存仍标记为「货盘库存」，新建商品入库为「自有库存」',
      '发货时可选择来源：平台订单 / 货盘分销 / 手工',
    ],
  },
  {
    from: 'ecommerce',
    to: 'hybrid',
    label: '电商客户 → 混合客户（开通货盘）',
    steps: [
      '账号类型改为「混合客户」',
      '套用混合模板，或追加：货盘选品、货盘入库等权限',
      '客户在货盘选品购货后形成「货盘库存」',
      '原有平台订单与自有库存不受影响',
    ],
  },
]

/** 客户业务开通说明（管理员创建账号时参考） */
export const ACCOUNT_TYPE_HINTS: Record<CustomerAccountType, string> = {
  ecommerce: '绑定店铺、同步平台订单，用自有库存预约发货',
  catalog: '在货盘选品购货，收货后在 OMS 预约发货给下游',
  hybrid: '同时经营自有电商与货盘分销，两套库存与发货来源',
}

/** 权限分组 — 系统管理员为客户勾选分配 */
export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  { label: '看板', permissions: ['dashboard:read'] },
  { label: '出库', permissions: ['order:read', 'order:write', 'order:export', 'outbound:read', 'outbound:write'] },
  { label: '货盘', permissions: ['catalog:read', 'catalog:write'] },
  { label: '商品与编码', permissions: ['product:read', 'product:write', 'platform:read', 'platform:write', 'code:read', 'code:apply', 'code:approve'] },
  { label: '入库', permissions: ['inbound:read', 'inbound:write'] },
  { label: '库存', permissions: ['inventory:read'] },
  { label: '物流', permissions: ['logistics:read'] },
  { label: '退件', permissions: ['returns:read', 'returns:write'] },
  { label: '费用', permissions: ['billing:read', 'billing:recharge'] },
  { label: '店铺', permissions: ['store:manage'] },
  { label: '报表', permissions: ['report:read'] },
]

export const ALL_CUSTOMER_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap(g => g.permissions)

const SYS_ADMIN_PERMISSIONS: Permission[] = [
  ...ALL_CUSTOMER_PERMISSIONS,
  'account:manage', 'account:disable', 'account:assign',
]

const ECOMMERCE_PERMISSIONS: Permission[] = [
  'dashboard:read',
  'order:read', 'order:write', 'order:export',
  'product:read', 'product:write',
  'code:read', 'code:apply',
  'platform:read', 'platform:write',
  'inbound:read', 'inbound:write',
  'outbound:read', 'outbound:write',
  'inventory:read',
  'logistics:read',
  'returns:read', 'returns:write',
  'billing:read',
  'store:manage',
  'report:read',
]

const CATALOG_PERMISSIONS: Permission[] = [
  'dashboard:read',
  'catalog:read', 'catalog:write',
  'product:read',
  'code:read',
  'inbound:read', 'inbound:write',
  'outbound:read', 'outbound:write',
  'inventory:read',
  'logistics:read',
  'billing:read',
  'report:read',
]

const HYBRID_PERMISSIONS: Permission[] = [
  ...new Set([...ECOMMERCE_PERMISSIONS, ...CATALOG_PERMISSIONS]),
]

/** 各客户类型默认权限模板（系统管理员可在此基础上调整） */
export const DEFAULT_TYPE_PERMISSIONS: Record<CustomerAccountType, Permission[]> = {
  ecommerce: ECOMMERCE_PERMISSIONS,
  catalog: CATALOG_PERMISSIONS,
  hybrid: HYBRID_PERMISSIONS,
}

/** 默认模板仅用于账号配置；登录后的权限始终由服务端会话传入。 */
export const ROLE_PERMISSIONS: Record<OmsRole, Permission[]> = {
  sys_admin: SYS_ADMIN_PERMISSIONS,
  ecommerce: DEFAULT_TYPE_PERMISSIONS.ecommerce,
  catalog: DEFAULT_TYPE_PERMISSIONS.catalog,
  hybrid: DEFAULT_TYPE_PERMISSIONS.hybrid,
}

export const ROUTE_PERMISSIONS: Record<string, Permission> = {
  '/': 'dashboard:read',
  '/home/welcome': 'dashboard:read',
  '/orders': 'order:read',
  '/outbound/records': 'outbound:read',
  '/outbound/orders': 'order:read',
  '/catalog': 'catalog:read',
  '/products': 'product:read',
  '/products/new': 'product:write',
  '/codes': 'code:read',
  '/platform-bindings': 'platform:read',
  '/inbound': 'inbound:read',
  '/inbound/records': 'inbound:read',
  '/inbound/qc': 'inbound:read',
  '/outbound': 'outbound:read',
  '/messages': 'dashboard:read',
  '/inventory': 'inventory:read',
  '/inventory/alerts': 'inventory:read',
  '/shipping': 'outbound:read',
  '/logistics': 'outbound:read',
  '/returns': 'returns:read',
  '/returns/apply': 'returns:write',
  '/returns/processing': 'returns:read',
  '/billing': 'billing:read',
  '/billing/recharge': 'billing:recharge',
  '/system/price-template': 'account:manage',
  '/system/region-template': 'account:manage',
  '/stores': 'store:manage',
  '/reports': 'report:read',
  '/accounts': 'account:manage',
}

export function can(role: OmsRole, permission: Permission, customPermissions?: Permission[]): boolean {
  if (role === 'sys_admin') return true
  const perms = customPermissions ?? ROLE_PERMISSIONS[role]
  return perms.includes(permission)
}

export function resolveRoutePermission(pathname: string): Permission | null {
  const exact = ROUTE_PERMISSIONS[pathname]
  if (exact) return exact
  const sorted = Object.keys(ROUTE_PERMISSIONS)
    .filter(p => p !== '/')
    .sort((a, b) => b.length - a.length)
  for (const path of sorted) {
    if (pathname.startsWith(path + '/')) return ROUTE_PERMISSIONS[path]
  }
  if (/^\/products\/[^/]+\/edit$/.test(pathname)) return 'product:write'
  if (/^\/products\/[^/]+$/.test(pathname)) return 'product:read'
  return null
}

export function canAccessRoute(role: OmsRole, pathname: string, customPermissions?: Permission[]): boolean {
  const basePath = pathname.split('?')[0]
  if (basePath === '/codes' || basePath === '/platform-bindings') {
    return can(role, 'code:read', customPermissions) || can(role, 'platform:read', customPermissions)
  }
  const permission = resolveRoutePermission(pathname)
  if (!permission) return true
  return can(role, permission, customPermissions)
}

export function navPermissionForRoute(to: string): Permission {
  if (to === '/codes') return 'code:read'
  return ROUTE_PERMISSIONS[to] ?? 'dashboard:read'
}

export function canAccessNavRoute(role: OmsRole, to: string, customPermissions?: Permission[]): boolean {
  if (to === '/codes') {
    return can(role, 'code:read', customPermissions) || can(role, 'platform:read', customPermissions)
  }
  return can(role, navPermissionForRoute(to), customPermissions)
}

export function permissionsForAccountType(type: CustomerAccountType): Permission[] {
  return [...DEFAULT_TYPE_PERMISSIONS[type]]
}
