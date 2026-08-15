import { SetMetadata } from '@nestjs/common'

export const PERMS_KEY = 'requiredPerms'
export const PERMS_ANY_KEY = 'requiredAnyPerms'

/** 必须同时拥有所列全部权限 */
export const RequirePerms = (...perms: string[]) => SetMetadata(PERMS_KEY, perms)

/** 拥有其中任意一项权限即可 */
export const RequireAnyPerm = (...perms: string[]) => SetMetadata(PERMS_ANY_KEY, perms)
