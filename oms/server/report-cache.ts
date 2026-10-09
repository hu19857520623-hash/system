import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type { Request, Response, NextFunction } from 'express'
import type { AuthClaims } from './auth.js'
import type { RedisJsonCache } from './redis-json-cache.js'

export class ReportScopeError extends Error {}
type ReportScope = { customerId: string | null; customerCode: string | null; role: string }

export function reportScope(auth?: AuthClaims): ReportScope {
  if (!auth || !auth.permissions.includes('report:read')) throw new ReportScopeError('没有报表查看权限')
  if (auth.role === 'sys_admin') return { customerId: null, customerCode: null, role: auth.role }
  if (!auth.customerId || !auth.customerCode) throw new ReportScopeError('当前账号未绑定客户，无法读取报表')
  return { customerId: auth.customerId, customerCode: auth.customerCode, role: auth.role }
}

export function reportSourceWrite(method: string, path: string, status: number) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    && status >= 200 && status < 300 && path.startsWith('/api/')
    && !path.startsWith('/api/auth/') && !path.startsWith('/api/system-messages')
}

export function reportInvalidation(cache: Pick<RedisJsonCache, 'invalidate'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.once('finish', () => {
      if (reportSourceWrite(req.method, req.originalUrl.split('?')[0], res.statusCode)) {
        // Business handlers commit their writes before sending a successful response.
        void cache.invalidate('oms-reports').catch(() => undefined)
      }
    })
    next()
  }
}

export class ReportSummaryCache {
  constructor(
    private prisma: Pick<PrismaClient, 'outboundOrder' | 'inventoryItem' | 'feeRecord'>,
    private cache: Pick<RedisJsonCache, 'remember'>,
    private clock: () => Date = () => new Date(),
  ) {}

  get(auth?: AuthClaims) {
    // Derive scope from the refreshed server identity before any cache access.
    const scope = reportScope(auth)
    const now = this.clock()
    const key = createHash('sha256').update(JSON.stringify([
      'summary-v1', scope.role, scope.customerId, scope.customerCode, now.getFullYear(), now.getMonth(),
    ])).digest('hex')
    return this.cache.remember('oms-reports', `oms:reports:summary:${key}`, 30, () => this.load(scope))
  }

  private async load(scope: ReportScope) {
    const customerId = scope.customerId
    const [outbounds, inventory, fees] = await Promise.all([
      this.prisma.outboundOrder.findMany({
        where: customerId ? { customerId } : undefined,
        select: { createdAt: true, totalQty: true, status: true, actualFeesTotal: true, preDeductTotal: true },
      }),
      this.prisma.inventoryItem.findMany({
        where: customerId ? { customerId } : undefined,
        select: { available: true, locked: true, shipped: true },
      }),
      this.prisma.feeRecord.findMany({
        where: customerId ? { customerCode: scope.customerCode! } : undefined,
        select: { type: true, amount: true },
      }),
    ])
    const now = this.clock()
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1)
      return { key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, label: `${date.getMonth() + 1}月` }
    })
    const trendMap = new Map(months.map(month => [month.key, { ...month, orders: 0, units: 0, amount: 0 }]))
    for (const order of outbounds) {
      const row = trendMap.get(String(order.createdAt || '').slice(0, 7))
      if (!row) continue
      row.orders += 1
      row.units += Number(order.totalQty) || 0
      row.amount += Number(order.actualFeesTotal ?? order.preDeductTotal) || 0
    }
    const feeLabels: Record<string, string> = {
      outbound: '出库费', storage: '仓储费', logistics: '物流费', operation: '操作费',
      recharge: '充值', refund: '退款', adjustment: '调整', other: '其他',
    }
    const feeMap = new Map<string, number>()
    for (const fee of fees) {
      const amount = Math.abs(Number(fee.amount) || 0)
      if (amount) feeMap.set(fee.type, (feeMap.get(fee.type) || 0) + amount)
    }
    const feeTotal = [...feeMap.values()].reduce((sum, amount) => sum + amount, 0)
    const activeOrders = outbounds.filter(order => order.status !== 'cancelled')
    const completedOrders = activeOrders.filter(order => ['shipped', 'delivered'].includes(order.status))
    const inventoryUnits = inventory.reduce((sum, item) => sum + item.available + item.locked, 0)
    const shippedUnits = inventory.reduce((sum, item) => sum + item.shipped, 0)
    return {
      updatedAt: now.toISOString(), cacheMaxAgeSeconds: 35,
      inventoryTurnoverDays: shippedUnits > 0 ? Math.round(inventoryUnits / shippedUnits * 300) / 10 : null,
      fulfillmentRate: activeOrders.length ? Math.round(completedOrders.length / activeOrders.length * 1000) / 10 : 0,
      totals: {
        outboundOrders: outbounds.length,
        completedOrders: completedOrders.length,
        exceptionOrders: outbounds.filter(order => order.status === 'exception').length,
        inventoryUnits,
        fees: Math.round(feeTotal * 100) / 100,
      },
      orderTrend: months.map(month => trendMap.get(month.key)),
      feeBreakdown: [...feeMap.entries()].map(([type, amount]) => ({
        type, label: feeLabels[type] || type, amount: Math.round(amount * 100) / 100,
        pct: feeTotal ? Math.round(amount / feeTotal * 1000) / 10 : 0,
      })).sort((left, right) => right.amount - left.amount),
    }
  }
}
