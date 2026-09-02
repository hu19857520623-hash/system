import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PermissionsService } from '../../common/permissions/permissions.service'
import { AnnouncementService } from '../announcement/announcement.service'
import {
  DASHBOARD_KPI_PERM_MAP,
  DASHBOARD_PIPELINE_DOMESTIC_PERM,
  DASHBOARD_PIPELINE_OVERSEAS_PERM,
  DASHBOARD_TRENDS_PERM,
  filterDashboardStats,
} from '@erp/shared/dashboard-widgets'
import { dayRangeUtc, mergeTrendCounts } from './dashboard.utils'

const SYNC_FAILED_WHERE: Prisma.SyncLogWhereInput = {
  status: 'failed',
  NOT: { syncType: { startsWith: 'test_' } },
}

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private announcementService: AnnouncementService,
    private permissions: PermissionsService,
  ) {}

  private async dashboardPermSet(userId?: number, roleCode?: string) {
    const widgetPerms = [
      ...Object.values(DASHBOARD_KPI_PERM_MAP),
      DASHBOARD_TRENDS_PERM,
      DASHBOARD_PIPELINE_DOMESTIC_PERM,
      DASHBOARD_PIPELINE_OVERSEAS_PERM,
    ]
    if (!userId || roleCode === 'admin') {
      return new Set(widgetPerms)
    }
    const codes = await this.permissions.getUserPermissions(userId, roleCode || '')
    return new Set(codes)
  }

  async stats(userId?: number, roleCode?: string) {
    const [products, suppliers, leads, pendingPo, pendingAudit, syncFailed] = await Promise.all([
      this.prisma.product.count(),
      this.prisma.supplier.count({ where: { status: 1 } }),
      this.prisma.lead.count(),
      this.prisma.purchaseOrder.count({ where: { status: 'pending_po_audit' } }),
      this.prisma.productDev.count({ where: { status: 'submitted' } }),
      this.prisma.syncLog.count({ where: SYNC_FAILED_WHERE }),
    ])
    const invAgg = await this.prisma.inventory.aggregate({ _sum: { availableQty: true } })
    const raw = {
      products,
      suppliers,
      leads,
      pendingPo,
      pendingAudit,
      syncFailed,
      inventoryAvailable: invAgg._sum.availableQty ?? 0,
    }
    const allowed = await this.dashboardPermSet(userId, roleCode)
    return filterDashboardStats(raw, allowed)
  }

  announcements() {
    return this.announcementService.listVisibleForErp(10)
  }

  async trends(days: number, userId?: number, roleCode?: string) {
    const allowed = await this.dashboardPermSet(userId, roleCode)
    if (!allowed.has(DASHBOARD_TRENDS_PERM)) {
      return { days: 0, series: [] }
    }
    const clamped = Math.min(30, Math.max(1, days))
    const ranges = dayRangeUtc(clamped)
    const receipts: number[] = []
    const receivedQty: number[] = []
    const damagedQty: number[] = []

    for (const range of ranges) {
      const where: Prisma.LogisticsReceiptWhereInput = {
        receivedAt: { gte: range.start, lt: range.end },
      }
      const count = await this.prisma.logisticsReceipt.count({ where })
      const agg = await this.prisma.logisticsReceiptItem.aggregate({
        where: { receipt: where },
        _sum: { actualQty: true, damagedQty: true },
      })
      receipts.push(count)
      receivedQty.push(agg._sum.actualQty ?? 0)
      damagedQty.push(agg._sum.damagedQty ?? 0)
    }

    return {
      days: clamped,
      series: mergeTrendCounts(ranges, receipts, receivedQty, damagedQty),
    }
  }

  async notifications() {
    const [
      leadsFollow,
      productAudit,
      purchaseAudit,
      purchasePaid,
      logisticsPending,
      inboundInTransit,
      inboundArrived,
      inboundReceiving,
      inboundPendingPutaway,
      inboundException,
      outboundPending,
      pricingTodo,
      syncFailed,
      mingruiPending,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { status: 'following' } }),
      this.prisma.productDev.count({ where: { status: 'submitted' } }),
      this.prisma.purchaseOrder.count({ where: { status: 'pending_po_audit' } }),
      this.prisma.purchaseOrder.count({ where: { paymentStatus: 'paid' } }),
      this.countPendingLogistics(),
      this.prisma.inboundOrder.count({ where: { status: { in: ['pending_receipt', 'pushed', 'pending_push'] } } }),
      this.prisma.inboundOrder.count({ where: { status: 'arrived' } }),
      this.prisma.inboundOrder.count({ where: { status: 'receiving' } }),
      this.prisma.inboundOrder.count({ where: { status: 'pending_putaway' } }),
      this.prisma.inboundOrder.count({ where: { status: 'exception' } }),
      this.prisma.outboundOrder.count({
        where: {
          status: { in: ['pending_pick', 'picking', 'picked', 'reviewing', 'pending_relabel', 'packed'] },
        },
      }),
      this.prisma.productPricing.count({ where: { pricingStatus: { in: ['pending_pricing', 'priced'] } } }),
      this.prisma.syncLog.count({ where: SYNC_FAILED_WHERE }),
      this.prisma.mingruiShipment.count({ where: { status: { in: ['draft', 'submitted'] } } }),
    ])

    const inboundReceipt = inboundArrived + inboundReceiving

    const items = [
      { key: 'leads_follow', screenId: 'leads_follow', title: '待跟进线索', count: leadsFollow, route: '/leads/follow', tone: 'warn' as const },
      { key: 'product_audit', screenId: 'product_audit', title: '待审选品', count: productAudit, route: '/product-audit', tone: 'warn' as const },
      { key: 'purchase', screenId: 'purchase', title: '待审采购单', count: purchaseAudit, route: '/purchase', tone: 'warn' as const },
      { key: 'purchase_paid', screenId: 'purchase', title: '已打款采购单', count: purchasePaid, route: '/purchase', tone: 'info' as const },
      { key: 'logistics_wh', screenId: 'logistics_wh', title: '待中转收货', count: logisticsPending, route: '/logistics-wh', tone: 'warn' as const },
      { key: 'mingrui', screenId: 'mingrui', title: '明瑞在途', count: mingruiPending, route: '/mingrui', tone: 'warn' as const },
      { key: 'inbound_in_transit', screenId: 'inbound_arrival', title: '在途待扫描', count: inboundInTransit, route: '/inbound/arrival-scan', tone: 'warn' as const },
      { key: 'inbound_arrived', screenId: 'inbound', title: '已到仓待收', count: inboundArrived, route: '/inbound/receipt', tone: 'warn' as const },
      ...(inboundReceiving > 0 ? [{ key: 'inbound_receiving', screenId: 'inbound', title: '收货中入库单', count: inboundReceiving, route: '/inbound/receipt', tone: 'warn' as const }] : []),
      { key: 'inbound_putaway', screenId: 'inbound_putaway', title: '待上架', count: inboundPendingPutaway, route: '/inbound/arrival-scan?step=putaway', tone: 'warn' as const },
      { key: 'outbound', screenId: 'outbound', title: '待出库', count: outboundPending, route: '/outbound', tone: 'warn' as const },
      ...(inboundException > 0 ? [{ key: 'inbound_exception', screenId: 'inbound', title: '入库异常', count: inboundException, route: '/inbound/receipt', tone: 'err' as const }] : []),
      { key: 'pricing', screenId: 'pricing', title: '待定价/同步', count: pricingTodo, route: '/pricing', tone: 'warn' as const },
      { key: 'sync', screenId: 'sync', title: '同步失败', count: syncFailed, route: '/sync', tone: 'err' as const },
    ]

    const total = items.reduce((sum, item) => sum + item.count, 0)
    const badges = Object.fromEntries(items.map((item) => [item.key, item.count]))
    badges.inbound_receipt = inboundReceipt
    return { total, items, badges }
  }

  private async countPendingLogistics() {
    const pos = await this.prisma.purchaseOrder.findMany({
      where: { status: { in: ['finance_approved', 'at_logistics_wh', 'approved'] } },
      select: { items: { select: { quantity: true, receivedQty: true } } },
    })
    return pos.filter((po) => po.items.some((i) => (i.receivedQty ?? 0) < i.quantity)).length
  }
}
