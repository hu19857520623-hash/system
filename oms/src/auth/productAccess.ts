import { authSessionScope, getStoredAuthSession } from '../api/client'
import { can } from './permissions'

export function currentProductWriteScope(): string | null {
  const session = getStoredAuthSession()
  return session && can(session.user.role, 'product:write', session.user.permissions) ? authSessionScope(session) : null
}

export function requireProductWriteScope(): string {
  const scope = currentProductWriteScope()
  if (!scope) throw new Error('当前账号没有商品维护权限，请返回商品列表查看，或联系管理员核对权限')
  return scope
}
