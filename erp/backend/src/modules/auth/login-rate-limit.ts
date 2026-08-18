export class LoginRateLimiter {
  private readonly hits = new Map<string, { fails: number[]; lockedUntil: number }>()

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly lockMs = 10 * 60_000,
    private readonly now = () => Date.now(),
  ) {}

  assertAllowed(key: string) {
    const entry = this.prune(key)
    if (entry.lockedUntil > this.now()) {
      const minutes = Math.max(1, Math.ceil((entry.lockedUntil - this.now()) / 60_000))
      throw Object.assign(new Error(`登录失败次数过多，请 ${minutes} 分钟后再试`), { status: 429 })
    }
  }

  recordFailure(key: string) {
    const entry = this.prune(key)
    const ts = this.now()
    entry.fails.push(ts)
    if (entry.fails.length >= this.maxFailures) {
      entry.lockedUntil = ts + this.lockMs
      entry.fails = []
    }
    this.hits.set(key, entry)
  }

  recordSuccess(key: string) {
    this.hits.delete(key)
  }

  private prune(key: string) {
    const ts = this.now()
    const current = this.hits.get(key) || { fails: [], lockedUntil: 0 }
    current.fails = current.fails.filter((at) => ts - at < this.windowMs)
    if (current.lockedUntil && current.lockedUntil <= ts) current.lockedUntil = 0
    this.hits.set(key, current)
    return current
  }
}
