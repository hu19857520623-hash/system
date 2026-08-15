/** @deprecated 请直接从 shared/permissions.catalog 导入；此文件仅作后端兼容 re-export */
export {
  ALL_PERM_CODES,
  DEPRECATED_PERM_CODES,
  PERM_ALIASES,
  PERM_GROUPS,
  ROLE_CODE_TEMPLATE,
  ROLE_DEFINITIONS,
  ROLE_PERM_TEMPLATES,
  STORE_MONITOR_ASSIGN_PERM,
  defaultPermsForRoleCode,
  normalizePermCodes,
  permLabel,
  permModule,
  templatePermsForRoleName,
} from '@erp/shared/permissions.catalog'

export type { PermissionGroup, PermissionItem } from '@erp/shared/permissions.catalog'
