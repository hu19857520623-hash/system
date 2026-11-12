import { createHash } from 'crypto'

type SalesUser = { id: bigint | number; username: string; realName?: string | null }

/** 跟进销售是历史文本：按完整姓名/账号匹配，重名不能授予权限。 */
export function isCurrentLeadSales(value: string | null | undefined, userId: number, users: SalesUser[]): boolean {
  if (!users.some(item => Number(item.id) === userId)) return false
  const norm = (text?: string | null) => String(text || '').trim().toLowerCase()
  const unambiguousAlias = (alias: string) => {
    const matches = users.filter(item => norm(item.username) === alias || norm(item.realName) === alias)
    return matches.length === 1 && Number(matches[0].id) === userId
  }
  return String(value || '').split(/[,，;；]/).some(raw => {
    const token = norm(raw)
    if (!token) return false
    const wrapped = token.match(/^(.+?)\(([^()]+)\)$/)
    if (wrapped) {
      // 已存在的账号优先，不能凭同名获得另一个账号的线索。
      const account = users.find(item => norm(item.username) === wrapped[2])
      if (account) return Number(account.id) === userId
      return unambiguousAlias(wrapped[1])
    }
    return unambiguousAlias(token.replace(/@微信$/, ''))
  })
}

export const SHARED_POOL_STATUSES = ['new', 'lost', 'nurture', 'recall']

export function followUpRevision(record: {
  followType: string; content: string; nextPlan?: string | null; nextFollowAt?: Date | null
}): string {
  return createHash('sha256').update(JSON.stringify([
    record.followType, record.content, record.nextPlan ?? null, record.nextFollowAt?.toISOString() ?? null,
  ])).digest('hex')
}
