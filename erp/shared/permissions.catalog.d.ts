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
/** 角色元数据（种子 / 管理页） */
export declare const ROLE_DEFINITIONS: readonly [{
    readonly roleCode: "admin";
    readonly roleName: "系统管理员";
    readonly templateKey: "系统管理员";
    readonly description: "拥有全部业务权限";
}, {
    readonly roleCode: "ops_manager";
    readonly roleName: "采购主管";
    readonly templateKey: "采购主管";
    readonly description: "采购审核、国内物流与海外入库协调";
}, {
    readonly roleCode: "purchaser";
    readonly roleName: "采购";
    readonly templateKey: "采购";
    readonly description: "采购下单、发运与明瑞物流";
}, {
    readonly roleCode: "warehouse";
    readonly roleName: "仓库";
    readonly templateKey: "仓库";
    readonly description: "收货、上架、出库与盘点";
}, {
    readonly roleCode: "finance";
    readonly roleName: "财务";
    readonly templateKey: "财务";
    readonly description: "结算、充值与报表";
}, {
    readonly roleCode: "cs";
    readonly roleName: "销售";
    readonly templateKey: "销售";
    readonly description: "线索跟进与成交";
}, {
    readonly roleCode: "sales_manager";
    readonly roleName: "销售主管";
    readonly templateKey: "销售主管";
    readonly description: "线索分配、团队跟进与报表";
}, {
    readonly roleCode: "dev_manager";
    readonly roleName: "产品开发主管";
    readonly templateKey: "产品开发主管";
    readonly description: "选品审核与定价";
}, {
    readonly roleCode: "viewer";
    readonly roleName: "产品开发";
    readonly templateKey: "产品开发";
    readonly description: "选品提交";
}, {
    readonly roleCode: "coach";
    readonly roleName: "陪跑";
    readonly templateKey: "陪跑";
    readonly description: "定价与 OMS 同步";
}, {
    readonly roleCode: "coach1";
    readonly roleName: "陪跑1";
    readonly templateKey: "陪跑1";
    readonly description: "店铺监控 1-5";
}, {
    readonly roleCode: "coach2";
    readonly roleName: "陪跑2";
    readonly templateKey: "陪跑2";
    readonly description: "店铺监控 6-9,0";
}];
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
