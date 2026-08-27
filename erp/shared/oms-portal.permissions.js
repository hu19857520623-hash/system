"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OMS_PERMISSION_TEMPLATES = exports.OMS_PORTAL_PERMISSION_GROUPS = exports.OMS_PORTAL_PERMISSIONS = exports.OMS_CUSTOMER_TYPES = void 0;
exports.resolveOmsPermissions = resolveOmsPermissions;
exports.OMS_CUSTOMER_TYPES = ['ecommerce', 'catalog', 'hybrid'];
exports.OMS_PORTAL_PERMISSIONS = [
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
];
exports.OMS_PORTAL_PERMISSION_GROUPS = [
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
];
const ECOMMERCE_PERMISSIONS = [
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
];
const CATALOG_PERMISSIONS = [
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
];
exports.OMS_PERMISSION_TEMPLATES = {
    ecommerce: ECOMMERCE_PERMISSIONS,
    catalog: CATALOG_PERMISSIONS,
    hybrid: [...new Set([...ECOMMERCE_PERMISSIONS, ...CATALOG_PERMISSIONS])],
};
function resolveOmsPermissions(template, explicit) {
    if (explicit)
        return [...new Set(explicit)];
    return template ? [...exports.OMS_PERMISSION_TEMPLATES[template]] : [];
}
//# sourceMappingURL=oms-portal.permissions.js.map