import { SetMetadata } from '@nestjs/common'

export const ROLES_KEY = 'roles'
/** 限定可访问的角色 roleCode，如 @Roles('admin', 'purchaser') */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles)
