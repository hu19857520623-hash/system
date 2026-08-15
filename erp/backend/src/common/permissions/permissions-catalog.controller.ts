import { Controller, Get } from '@nestjs/common'
import { RequirePerms } from '../decorators/require-perms.decorator'
import {
  DEPRECATED_PERM_CODES,
  PERM_ALIASES,
  PERM_GROUPS,
  ROLE_CODE_TEMPLATE,
  ROLE_DEFINITIONS,
  ROLE_PERM_TEMPLATES,
} from '@erp/shared/permissions.catalog'

@Controller('permissions')
/** NestJS 实现；Spring migration 模式下由 erp-auth-service 原生提供同结构 JSON */
export class PermissionsCatalogController {
  @RequirePerms('permissions.view')
  @Get('catalog')
  catalog() {
    return {
      groups: PERM_GROUPS,
      roleDefinitions: ROLE_DEFINITIONS,
      roleCodeTemplate: ROLE_CODE_TEMPLATE,
      roleTemplates: ROLE_PERM_TEMPLATES,
      deprecated: DEPRECATED_PERM_CODES,
      aliases: PERM_ALIASES,
    }
  }
}
