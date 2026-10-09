import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { Request, Response } from 'express'
import type { AuthClaims } from './auth.js'
import { RedisJsonCache } from './redis-json-cache.js'
import { ReportSummaryCache, ReportScopeError, reportInvalidation, reportSourceWrite } from './report-cache.js'

const identity = (id = 'A', code = 'CA', role: AuthClaims['role'] = 'ecommerce'): AuthClaims => ({
  userId: 'u-' + id, customerId: id, customerCode: code, role,
  permissions: ['report:read'], mustChangePassword: false,
})

function setup() {
  let time = new Date('2026-10-08T00:00:00Z')
  const calls: { model: string; args: any }[] = []
  const entries = new Map<string, { value: any; expires: number }>()
  const keys: string[] = []
  const prisma = {
    outboundOrder: { findMany: async (args: any) => {
      calls.push({ model: 'orders', args })
      return [{ createdAt: '2026-10-01', totalQty: 2, status: 'shipped', actualFeesTotal: 10, preDeductTotal: 12 },
        { createdAt: '2026-10-02', totalQty: 3, status: 'pending', actualFeesTotal: null, preDeductTotal: 20 }]
    } },
    inventoryItem: { findMany: async (args: any) => {
      calls.push({ model: 'inventory', args })
      return [{ available: 4, locked: 1, shipped: 10 }]
    } },
    feeRecord: { findMany: async (args: any) => {
      calls.push({ model: 'fees', args })
      return [{ type: 'outbound', amount: -10 }, { type: 'storage', amount: 20 }]
    } },
  }
  const cache = {
    remember: async <T>(group: string, key: string, ttl: number, load: () => Promise<T>): Promise<T> => {
      keys.push(key)
      const id = group + ':' + key
      const entry = entries.get(id)
      if (entry && entry.expires > time.getTime()) return entry.value
      const value = await load()
      entries.set(id, { value: JSON.parse(JSON.stringify(value)), expires: time.getTime() + ttl * 1000 })
      return value
    },
    invalidate: async (group: string) => {
      for (const id of entries.keys()) if (id.startsWith(group + ':')) entries.delete(id)
    },
  }
  const service = new ReportSummaryCache(prisma as unknown as ConstructorParameters<typeof ReportSummaryCache>[0], cache, () => time)
  return { service, cache, calls, keys, entries, prisma, setTime: (date: string) => { time = new Date(date) } }
}

test('customer summaries hit cache and store only aggregated output', async () => {
  const { service, calls, entries } = setup()
  const first = await service.get(identity())
  const second = await service.get(identity())
  assert.deepEqual(second, first)
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[0].args.where, { customerId: 'A' })
  assert.deepEqual(calls[1].args.where, { customerId: 'A' })
  assert.deepEqual(calls[2].args.where, { customerCode: 'CA' })
  assert.deepEqual(first.totals, { outboundOrders: 2, completedOrders: 1, exceptionOrders: 0, inventoryUnits: 5, fees: 30 })
  assert.equal(first.fulfillmentRate, 50)
  assert.equal(first.inventoryTurnoverDays, 15)
  assert.equal(first.orderTrend.at(-1)?.amount, 30)
  assert.equal(first.updatedAt, '2026-10-08T00:00:00.000Z')
  assert.equal(first.cacheMaxAgeSeconds, 35)
  const stored = [...entries.values()][0].value
  assert.equal('outbounds' in stored || 'inventory' in stored || 'customerId' in stored, false)
})

test('customers, fee scopes and administrator totals have separate keys', async () => {
  const { service, keys, calls } = setup()
  await service.get(identity('A', 'CA'))
  await service.get(identity('B', 'CB'))
  await service.get(identity('A', 'NEW-CA'))
  await service.get(identity('A', 'CA', 'sys_admin'))
  assert.equal(new Set(keys).size, 4)
  assert.equal(calls.length, 12)
  assert.equal(calls[9].args.where, undefined)
  assert.deepEqual(calls[8].args.where, { customerCode: 'NEW-CA' })
})

test('missing identity, report permission or customer binding is rejected before cache access', () => {
  const { service, keys, calls } = setup()
  for (const auth of [undefined, { ...identity(), permissions: [] },
    { ...identity(), customerId: null }, { ...identity(), customerCode: null }]) {
    assert.throws(() => service.get(auth), ReportScopeError)
  }
  assert.equal(keys.length, 0)
  assert.equal(calls.length, 0)
})

test('expired summaries reload and a new month uses a new cache key', async () => {
  const { service, calls, keys, setTime } = setup()
  await service.get(identity())
  setTime('2026-10-08T00:00:31Z')
  const refreshed = await service.get(identity())
  assert.equal(calls.length, 6)
  assert.equal(refreshed.updatedAt, '2026-10-08T00:00:31.000Z')
  setTime('2026-11-08T00:00:00Z')
  await service.get(identity())
  assert.notEqual(keys[0], keys[2])
})

test('successful business responses invalidate summaries; failed, read and login requests do not', async () => {
  const { service, cache, calls } = setup()
  const hook = reportInvalidation(cache)
  const send = async (method: string, path: string, status: number) => {
    const res = Object.assign(new EventEmitter(), { statusCode: status })
    hook({ method, originalUrl: path } as Request, res as unknown as Response, () => {})
    res.emit('finish')
    await Promise.resolve()
  }
  await service.get(identity())
  await send('PUT', '/api/inventory-state', 400)
  await send('GET', '/api/reports/summary', 200)
  await send('POST', '/api/auth/login', 200)
  await service.get(identity())
  assert.equal(calls.length, 3)
  await send('POST', '/api/erp/webhooks/events', 200)
  await service.get(identity())
  assert.equal(calls.length, 6)
  assert.equal(reportSourceWrite('DELETE', '/api/outbound-orders/X', 204), true)
})

test('disabled Redis falls back to the original queries and database failures propagate', async () => {
  const { prisma, calls } = setup()
  const cache = new RedisJsonCache({ REDIS_CACHE_ENABLED: 'false' })
  const service = new ReportSummaryCache(prisma as unknown as ConstructorParameters<typeof ReportSummaryCache>[0], cache)
  await service.get(identity())
  await service.get(identity())
  assert.equal(calls.length, 6)
  prisma.feeRecord.findMany = async () => { throw new Error('database unavailable') }
  await assert.rejects(service.get(identity()), /database unavailable/)
  cache.close()
})
