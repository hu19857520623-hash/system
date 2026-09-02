/** 从导入备注解析跟进销售：优先「再对接」，否则「对接」。 */
export function parseFollowSalesFromRemark(remark?: string | null): string {
  const text = String(remark || '')
  const again = text.match(/再对接:([^|]+)/)
  if (again?.[1]?.trim()) return again[1].trim()
  const first = text.match(/(?<!再)对接:([^|]+)/)
  if (first?.[1]?.trim()) return first[1].trim()
  return ''
}

export function resolveFollowSales(followSales?: string | null, remark?: string | null): string {
  return String(followSales || '').trim() || parseFollowSalesFromRemark(remark)
}

const MIN_ASCII_TOKEN_LEN = 3
const MIN_TOKEN_LEN = 2

/** 用当前用户的姓名/账号去匹配「跟进销售」字段（含「尚彩云, Ronan(Ronan)」这类多人写法）。 */
export function followSalesMatchTokens(user: {
  username?: string | null
  realName?: string | null
}): string[] {
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const raw of [user.realName, user.username]) {
    const token = String(raw || '').trim()
    if (!isUsableFollowSalesToken(token)) continue
    const key = token.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tokens.push(token)
  }
  return tokens
}

export function followSalesMatchesUser(
  followSales: string | null | undefined,
  user: { username?: string | null; realName?: string | null },
): boolean {
  const text = String(followSales || '').toLowerCase()
  if (!text) return false
  return followSalesMatchTokens(user).some((token) => text.includes(token.toLowerCase()))
}

/** 按跟进销售姓名反查归属运营（用于认领线索时自动填 assigneeId）。 */
export function resolveAssigneeIdByFollowSales(
  followSales: string | null | undefined,
  assignees: { id: bigint | number; username?: string | null; realName?: string | null }[],
): bigint | null {
  const text = String(followSales || '').trim()
  if (!text) return null
  for (const user of assignees) {
    if (followSalesMatchesUser(text, user)) return BigInt(user.id)
  }
  return null
}

function isUsableFollowSalesToken(token: string): boolean {
  if (token.length < MIN_TOKEN_LEN) return false
  if (/^[a-zA-Z0-9._-]+$/.test(token) && token.length < MIN_ASCII_TOKEN_LEN) return false
  return true
}
