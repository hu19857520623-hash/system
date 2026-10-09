import { createClient } from 'redis'

type CacheClient = ReturnType<typeof createClient>
type CacheEnvironment = Record<string, string | undefined>

/** Optional cache: database/API errors still propagate; Redis errors never do. */
export class RedisJsonCache {
  private readonly client: CacheClient | null
  private readonly prefix: string
  private readonly pending = new Map<string, Promise<unknown>>()
  private localGeneration = 0
  private lastWarning = 0
  private readonly counters = { hits: 0, misses: 0, errors: 0 }

  constructor(
    env: CacheEnvironment,
    private readonly warn: (message: string) => void = console.warn,
    client?: CacheClient,
  ) {
    this.prefix = env.REDIS_CACHE_PREFIX || 'takealot:cache:v1:'
    if (env.REDIS_CACHE_ENABLED !== 'true') {
      this.client = null
      return
    }
    if (client) {
      this.client = client
      return
    }
    const port = Number(env.REDIS_PORT || 6379)
    if (!env.REDIS_HOST || !Number.isInteger(port) || port < 1 || port > 65535
      || (env.NODE_ENV === 'production' && !env.REDIS_PASSWORD)) {
      throw new Error('Enabled Redis cache requires REDIS_HOST, a valid REDIS_PORT, and a production password')
    }
    this.client = createClient({
      username: env.REDIS_USERNAME || undefined,
      password: env.REDIS_PASSWORD || undefined,
      disableOfflineQueue: true,
      commandsQueueMaxLength: 128,
      commandOptions: { timeout: 200 },
      pingInterval: 5000,
      socket: {
        host: env.REDIS_HOST,
        port,
        connectTimeout: 1000,
        socketTimeout: 10000,
        reconnectStrategy: (attempt) => Math.min(500 * (attempt + 1), 5000),
      },
    })
    this.client.on('error', () => this.redisError())
    // Redis availability must not delay application startup.
    void this.client.connect().catch(() => this.redisError())
  }

  private redisError() {
    this.counters.errors++
    if (Date.now() - this.lastWarning > 60_000) {
      this.lastWarning = Date.now()
      this.warn('[cache] Redis unavailable; using the original data source')
    }
  }

  snapshot() {
    return { enabled: this.client !== null, ready: this.client?.isReady || false, ...this.counters }
  }

  private generationKey(group: string) {
    return this.prefix + group + ':generation'
  }

  private async bounded<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Redis cache deadline exceeded')), 200)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async remember<T>(group: string, key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    if (!this.client) return loader()
    const dataKey = this.prefix + key
    let generation: string | undefined
    if (this.client.isReady) {
      try {
        const [raw, current] = await this.bounded(this.client.mGet([dataKey, this.generationKey(group)]))
        generation = current || '0'
        if (raw !== null) {
          const cached = JSON.parse(raw) as { generation: string; value: T }
          if (cached.generation === generation && Object.prototype.hasOwnProperty.call(cached, 'value')) {
            this.counters.hits++
            return cached.value
          }
        }
      } catch {
        this.redisError()
      }
    }

    this.counters.misses++
    // Coalesce identical requests even while Redis is disconnected.
    const pendingKey = dataKey + ':' + (generation ?? 'offline') + ':' + this.localGeneration
    const existing = this.pending.get(pendingKey)
    if (existing) return existing as Promise<T>
    if (this.pending.size >= 128) return loader()

    const load = async () => {
      const value = await loader()
      if (generation !== undefined && this.client?.isReady) {
        try {
          const ttl = Math.max(1, Math.floor(ttlSeconds)) + Math.floor(Math.random() * 6)
          // A write must not refill the cache with a pre-invalidation result.
          await this.bounded(this.client.eval(
            "if (redis.call('GET', KEYS[1]) or '0') == ARGV[1] then return redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3]) else return 0 end",
            {
              keys: [this.generationKey(group), dataKey],
              arguments: [generation, JSON.stringify({ generation, value }), String(ttl)],
            },
          ))
        } catch {
          this.redisError()
        }
      }
      return value
    }
    const work = load()
    this.pending.set(pendingKey, work)
    try {
      return await work
    } finally {
      this.pending.delete(pendingKey)
    }
  }

  async invalidate(group: string) {
    this.localGeneration++
    if (!this.client?.isReady) return
    try {
      // ERP and OMS share the group generation, but use different data keys.
      await this.bounded(this.client.incr(this.generationKey(group)))
    } catch {
      this.redisError()
    }
  }

  close() {
    if (this.client?.isOpen) this.client.destroy()
  }
}
