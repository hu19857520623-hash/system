/** 跟进销售展示名：姓名与账号不同时写成「姓名(账号)」。 */
export function formatFollowSalesLabel(user: {
  username?: string | null
  realName?: string | null
  name?: string | null
}): string {
  const real = String(user.realName || user.name || '').trim()
  const username = String(user.username || '').trim()
  if (real && username && real.toLowerCase() !== username.toLowerCase()) {
    return `${real}(${username})`
  }
  return real || username
}

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

function followSalesAliasSet(user: {
  username?: string | null
  realName?: string | null
  name?: string | null
}): Set<string> {
  const real = String(user.realName || user.name || '').trim()
  const username = String(user.username || '').trim()
  const label = formatFollowSalesLabel(user)
  return new Set(
    [label, real, username, real ? `${real}@微信` : '', username ? `${username}@微信` : '']
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  )
}

/** 把同一系统账号的跟进销售别名收成「姓名(账号)」。多人写法保持原样。 */
export function canonicalizeFollowSales(
  followSales: string | null | undefined,
  users: { username?: string | null; realName?: string | null; name?: string | null }[],
): string {
  const text = String(followSales || '').trim()
  if (!text) return ''
  if (/[,，]/.test(text)) return text
  const lower = text.toLowerCase()
  for (const user of users) {
    if (followSalesAliasSet(user).has(lower)) return formatFollowSalesLabel(user) || text
  }
  const wrapped = text.match(/^(.+?)\((.+)\)$/)
  if (wrapped) {
    const name = wrapped[1].trim().toLowerCase()
    const nick = wrapped[2].trim().toLowerCase()
    const matchedByRealName = users.filter((user) => {
      const real = String(user.realName || user.name || '').trim().toLowerCase()
      return Boolean(real) && real === name
    })
    if (matchedByRealName.length === 1) return formatFollowSalesLabel(matchedByRealName[0]) || text
    const matchedByUsername = users.filter((user) => String(user.username || '').trim().toLowerCase() === nick)
    if (matchedByUsername.length === 1) return formatFollowSalesLabel(matchedByUsername[0]) || text
  }
  return text
}
