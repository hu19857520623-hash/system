import type { AuthClaims } from './auth.js'
export function catalogQuoteCustomer(auth: AuthClaims | undefined, requested?: unknown) {
  if (!auth) throw new Error('请先登录再读取货盘报价')
  if (auth.role === 'sys_admin') {
    if (requested == null) return undefined
    if (typeof requested !== 'string' || !requested.trim()) throw new Error('请选择有效报价客户')
    return requested.trim().toUpperCase()
  }
  if (!auth.customerCode) throw new Error('当前账号未绑定货盘报价客户')
  return auth.customerCode
}
