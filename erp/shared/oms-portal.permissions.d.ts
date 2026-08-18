export declare const OMS_CUSTOMER_TYPES: readonly ["ecommerce", "catalog", "hybrid"];
export type OmsCustomerType = (typeof OMS_CUSTOMER_TYPES)[number];
export declare const OMS_PORTAL_PERMISSIONS: readonly ["dashboard:read", "order:read", "order:write", "order:export", "catalog:read", "catalog:write", "product:read", "product:write", "code:read", "code:apply", "code:approve", "platform:read", "platform:write", "inbound:read", "inbound:write", "outbound:read", "outbound:write", "inventory:read", "logistics:read", "returns:read", "returns:write", "billing:read", "billing:recharge", "store:manage", "report:read"];
export type OmsPortalPermission = (typeof OMS_PORTAL_PERMISSIONS)[number];
export declare const OMS_PORTAL_PERMISSION_GROUPS: {
    label: string;
    permissions: OmsPortalPermission[];
}[];
export declare const OMS_PERMISSION_TEMPLATES: Record<OmsCustomerType, OmsPortalPermission[]>;
export declare function resolveOmsPermissions(template: OmsCustomerType | undefined, explicit: OmsPortalPermission[] | undefined): OmsPortalPermission[];
