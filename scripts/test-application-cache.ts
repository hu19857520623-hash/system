import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Socket } from 'node:net'
import { once } from 'node:events'
import { RedisJsonCache as ErpCache } from '../erp/backend/src/common/cache/redis-json-cache.js'
import { RedisJsonCache as OmsCache } from '../oms/server/redis-json-cache.js'

type Client = NonNullable<ConstructorParameters<typeof ErpCache>[2]>

class Store {
  now = 0
  values = new Map<string, { value: string; expires: number }>()
  failReads = false
  failWrites = false

  get(key: string) {
    const row = this.values.get(key)
    return row && row.expires > this.now ? row.value : null
  }

  client() {
    return {
      isReady: true,
      isOpen: false,
      mGet: async (keys: string[]) => {
        if (this.failReads) throw new Error('read failed')
        return keys.map(key => this.get(key))
      },
      eval: async (_script: string, options: { keys: string[]; arguments: string[] }) => {
        if (this.failWrites) throw new Error('write failed')
        const [versionKey, key] = options.keys
        const [version, value, ttl] = options.arguments
        if ((this.get(versionKey) || '0') !== version) return 0
        this.values.set(key, { value, expires: this.now + Number(ttl) * 1000 })
        return 'OK'
      },
      incr: async (key: string) => {
        if (this.failWrites) throw new Error('write failed')
        const next = Number(this.get(key) || 0) + 1
        this.values.set(key, { value: String(next), expires: Infinity })
        return next
      },
    } as unknown as Client
  }
}

const env = { REDIS_CACHE_ENABLED: 'true' }

for (const [name, Cache] of [['ERP', ErpCache], ['OMS', OmsCache]] as const) {
  test(name + ': the real client times out a stalled Redis command and falls back', { timeout: 5000 }, async () => {
    const sockets = new Set<Socket>()
    let reads = 0
    // Minimal RESP peer: accept the connection handshake, then stall MGET.
    const server = createServer(socket => {
      sockets.add(socket)
      let buffer = Buffer.alloc(0)
      socket.on('error', () => {})
      socket.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk])
        while (buffer.length) {
          const header = buffer.indexOf('\r\n')
          if (header < 0) return
          const count = Number(buffer.subarray(1, header).toString())
          let offset = header + 2
          const args: string[] = []
          for (let i = 0; i < count; i++) {
            const end = buffer.indexOf('\r\n', offset)
            if (end < 0) return
            const length = Number(buffer.subarray(offset + 1, end).toString())
            const start = end + 2
            if (buffer.length < start + length + 2) return
            args.push(buffer.subarray(start, start + length).toString())
            offset = start + length + 2
          }
          buffer = buffer.subarray(offset)
          if (args[0]?.toUpperCase() === 'MGET') reads++
          else if (args[0]?.toUpperCase() === 'HELLO') {
            socket.write('%2\r\n+id\r\n:1\r\n+proto\r\n:3\r\n')
          } else if (args[1]?.toUpperCase() === 'MAINT_NOTIFICATIONS') {
            socket.write('-ERR unknown subcommand\r\n')
          } else socket.write('+OK\r\n')
        }
      })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const cache = new Cache({
      ...env, REDIS_HOST: '127.0.0.1', REDIS_PORT: String(address.port),
    }, () => {})
    try {
      const deadline = Date.now() + 2000
      while (!cache.snapshot().ready && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      assert.equal(cache.snapshot().ready, true)
      const started = Date.now()
      assert.equal(await cache.remember('dest', 'key', 30, async () => 42), 42)
      assert.ok(Date.now() - started < 1000, 'Redis stalled the request')
      assert.equal(reads, 1)
      assert.ok(cache.snapshot().errors > 0)
    } finally {
      cache.close()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  test(name + ': disabled cache uses source without connecting', async () => {
    const cache = new Cache({})
    const value = { items: [] }
    assert.equal(await cache.remember('dest', 'key', 30, async () => value), value)
    assert.equal(cache.snapshot().enabled, false)
  })

  test(name + ': hits avoid source work and expired entries reload', async () => {
    const store = new Store()
    const cache = new Cache(env, () => {}, store.client())
    let calls = 0
    const load = async () => ({ count: ++calls })
    assert.deepEqual(await cache.remember('dest', 'key', 30, load), { count: 1 })
    assert.deepEqual(await cache.remember('dest', 'key', 30, load), { count: 1 })
    store.now = 36_000
    assert.deepEqual(await cache.remember('dest', 'key', 30, load), { count: 2 })
    assert.equal(cache.snapshot().hits, 1)
  })

  test(name + ': concurrent misses share one source request', async () => {
    const cache = new Cache(env, () => {}, new Store().client())
    let calls = 0
    const load = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return [] }
    await Promise.all(Array.from({ length: 20 }, () => cache.remember('dest', 'key', 30, load)))
    assert.equal(calls, 1)
  })

  test(name + ': Redis read/write failures fall back but source errors propagate', async () => {
    const store = new Store()
    const cache = new Cache(env, () => {}, store.client())
    store.failReads = store.failWrites = true
    assert.equal(await cache.remember('dest', 'key', 30, async () => 42), 42)
    store.failReads = false
    assert.equal(await cache.remember('dest', 'key', 30, async () => 43), 43)
    await assert.rejects(cache.remember('dest', 'key', 30, async () => {
      throw new Error('database failure')
    }), /database failure/)
    store.failWrites = false
    assert.equal(await cache.remember('dest', 'key', 30, async () => 44), 44)
  })

  test(name + ': corrupted values reload rather than reaching the client', async () => {
    const store = new Store()
    store.values.set('takealot:cache:v1:key', { value: '{bad', expires: Infinity })
    const cache = new Cache(env, () => {}, store.client())
    assert.equal(await cache.remember('dest', 'key', 30, async () => 42), 42)
  })

  test(name + ': disconnected Redis still coalesces source requests', async () => {
    const client = new Store().client()
    Object.defineProperty(client, 'isReady', { value: false })
    const cache = new Cache(env, () => {}, client)
    let calls = 0
    const load = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return 42 }
    await Promise.all(Array.from({ length: 20 }, () => cache.remember('dest', 'key', 30, load)))
    assert.equal(calls, 1)
  })

  test(name + ': a source result started before invalidation cannot refill the cache', async () => {
    const store = new Store()
    const cache = new Cache(env, () => {}, store.client())
    let complete!: (value: number) => void
    let started!: () => void
    const begun = new Promise<void>(resolve => { started = resolve })
    const old = cache.remember('dest', 'key', 30, () => {
      started()
      return new Promise<number>(resolve => { complete = resolve })
    })
    await begun
    await cache.invalidate('dest')
    assert.equal(await cache.remember('dest', 'key', 30, async () => 2), 2)
    complete(1)
    assert.equal(await old, 1)
    assert.equal(await cache.remember('dest', 'key', 30, async () => 3), 2)
  })
}

test('ERP mutation invalidates OMS cache through the shared group generation', async () => {
  const store = new Store()
  const erp = new ErpCache(env, () => {}, store.client())
  const oms = new OmsCache(env, () => {}, store.client())
  await erp.remember('takealot-dest', 'erp:fulfillment', 30, async () => ['old'])
  await oms.remember('takealot-dest', 'oms:fulfillment', 30, async () => ['old'])
  await erp.invalidate('takealot-dest')
  assert.deepEqual(await oms.remember('takealot-dest', 'oms:fulfillment', 30, async () => ['new']), ['new'])
  assert.deepEqual(await erp.remember('takealot-dest', 'erp:fulfillment', 30, async () => ['new']), ['new'])
})
