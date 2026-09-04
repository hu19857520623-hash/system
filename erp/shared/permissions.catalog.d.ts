/**
 * ERP 权限单源配置（SSOT）
 * 后端、Java auth-service、用户管理页均由此导出；改分组/标签后请跑 sync:java-permissions + sync:permissions
 */
export interface PermissionItem {
    id: string;
    label: string;
}
export interface PermissionGroup {
    label: string;
    perms: PermissionItem[];
}
/** 按业务模块分组的权限（用户管理勾选 UI + sys_permission 中文名） */
export declare const PERM_GROUPS: PermissionGroup[];
/** 已废弃权限码，读取/写入时自动剔除 */
export declare const DEPRECATED_PERM_CODES: readonly string[];
/** 旧码 → 新码；值为 null 表示直接删除 */
export declare const PERM_ALIASES: Record<string, string | null>;
/** 角色默认权限模板（按中文角色名） */
export declare const ROLE_PERM_TEMPLATES: Record<string, string[]>;
/** 后端 roleCode → 权限模板名 */
export declare const ROLE_CODE_TEMPLATE: Record<string, string>;
export type RoleSide = 'office' | 'warehouse' | 'system';
export declare const ROLE_SIDE_LABELS: Record<RoleSide, string>;
export type RoleDefinition = {
    roleCode: string;
    roleName: string;
    templateKey: string;
    description: string;
    side: RoleSide;
};
/** 角色元数据（种子 / 管理页）。side 决定能否出现在仓储端（拣货员 / 工位 / PDA） */
export declare const ROLE_DEFINITIONS: readonly RoleDefinition[];
/** 可被分配为线索归属人的销售角色 */
export declare const LEAD_ASSIGNEE_ROLE_CODES: readonly ["cs", "sales_manager"];
/** 新建线索时强制归属当前登录人的销售角色（不含销售主管） */
export declare const LEAD_SELF_ASSIGN_ROLE_CODES: readonly ["cs"];
export declare const ALL_PERM_CODES: string[];
export declare const STORE_MONITOR_ASSIGN_PERM = "store_monitor.assign";
export declare function permLabel(code: string): string;
export declare function permModule(code: string): string;
/** 剔除废弃码、应用别名，仅保留 catalog 中存在的权限 */
export declare function normalizePermCodes(codes: string[]): string[];
export declare function defaultPermsForRoleCode(roleCode: string): string[];
export declare function templatePermsForRoleName(roleName: string): string[];
export declare function roleDefinition(roleCode: string): RoleDefinition | undefined;
/** 未知职位按办公处理，避免误入仓储端 */
export declare function roleSide(roleCode: string): RoleSide;
export declare function catalogRoleName(roleCode: string, fallback?: string): string;
export declare function isKnownRoleCode(roleCode: string): boolean;
export declare function isWarehouseStaffRole(roleCode: string): boolean;
/** 仓储端（PDA / 拣货员 / 工位）可用的职位：仓库 + 系统管理员 */
export declare function canUseWarehouseClient(roleCode: string): boolean;
export declare const WAREHOUSE_STAFF_ROLE_CODES: string[];
export declare const OFFICE_ROLE_CODES: string[];
export declare function roleCodesBySide(side: RoleSide): string[];
