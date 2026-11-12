/** 并发事务死锁/锁等待超时的安全重试：仅对明确未生效的冲突重试，其余异常原样抛出。 */
export function isDeadlockError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null
  const code = String(e?.code || '')
  const message = String(e?.message || '')
  return code === 'P2034' || code === 'P2028'
    || /Deadlock found|try restarting transaction|Lock wait timeout/i.test(message)
}

export async function withDeadlockRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (!isDeadlockError(error) || attempt >= retries) throw error
    }
  }
}
