/** Business reads plus the minimum supporting records required by authorized forms. */
export const DATA_READ_PERMISSIONS = {
  products: ['product:read', 'product:write', 'inbound:write', 'outbound:write', 'returns:write', 'platform:read', 'platform:write', 'code:apply', 'code:approve'],
  inventory: ['inventory:read', 'outbound:write', 'catalog:write', 'platform:write', 'code:approve'],
  orders: ['order:read', 'order:write'],
  inboundOrders: ['inbound:read', 'inbound:write'],
  outboundOrders: ['outbound:read', 'outbound:write', 'order:read'],
  returnOrders: ['returns:read', 'returns:write'],
  logistics: ['logistics:read', 'outbound:read', 'outbound:write', 'order:read'],
  platformSkuMappings: ['platform:read', 'platform:write', 'code:read', 'code:apply', 'code:approve', 'outbound:write'],
  stores: ['store:manage', 'platform:read', 'platform:write', 'order:read', 'order:write', 'outbound:write'],
  purchases: ['catalog:read', 'catalog:write'],
  catalog: ['catalog:read', 'catalog:write', 'platform:read', 'platform:write', 'outbound:write'],
  balance: ['billing:read', 'billing:recharge', 'catalog:write', 'outbound:write'],
  billing: ['billing:read'],
  recharges: ['billing:read', 'billing:recharge'],
  messages: ['dashboard:read'],
} as const
export type DataResource = keyof typeof DATA_READ_PERMISSIONS
export type ReadIdentity = { role: string; permissions: readonly string[] }
export function canReadData(identity: ReadIdentity, resource: DataResource) {
  return identity.role === 'sys_admin' || DATA_READ_PERMISSIONS[resource].some(permission => identity.permissions.includes(permission))
}
