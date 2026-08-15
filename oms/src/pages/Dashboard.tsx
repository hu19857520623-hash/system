import { Link } from 'react-router-dom'
import {
  ArrowDownToLine, ArrowUpFromLine, Package, ShoppingCart, Wallet,
  Bell, AlertTriangle, Warehouse, FileText,
} from 'lucide-react'
import { Card, CardHeader, Badge, MonoCode } from '../components/ui'
import { formatCurrency, welcomePending, dashboardStats } from '../data/mockData'
import { useAnnouncements, useCustomerProfile, useInboundOrders, useOrders } from '../data/entityStore'
import { useOutboundOrders } from '../data/outboundStore'
import { useBilling } from '../data/billingStore'
import { useRole } from '../auth/RoleContext'
import { useDataScope } from '../auth/useDataScope'
import { ROLE_LABELS } from '../auth/permissions'

const quickActions = [
  { to: '/inbound', label: '预约入库', icon: ArrowDownToLine, perm: 'inbound:write' as const, color: 'bg-orange-50 text-orange-700 ring-orange-100' },
  { to: '/outbound', label: '预约发货', icon: ArrowUpFromLine, perm: 'outbound:read' as const, color: 'bg-blue-50 text-blue-700 ring-blue-100' },
  { to: '/inventory', label: '库存查询', icon: Package, perm: 'inventory:read' as const, color: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  { to: '/outbound/records', label: '订单与出库', icon: ShoppingCart, perm: 'order:read' as const, color: 'bg-violet-50 text-violet-700 ring-violet-100' },
  { to: '/billing', label: '费用账单', icon: Wallet, perm: 'billing:read' as const, color: 'bg-amber-50 text-amber-700 ring-amber-100' },
  { to: '/messages', label: '消息中心', icon: Bell, perm: 'dashboard:read' as const, color: 'bg-red-50 text-red-700 ring-red-100', badge: welcomePending.unreadMessages },
]

export default function Dashboard() {
  const { can, role } = useRole()
  const dataScope = useDataScope()
  const orders = useOrders()
  const inboundOrders = useInboundOrders()
  const outboundOrders = useOutboundOrders()
  const announcements = useAnnouncements()
  const customer = useCustomerProfile()
  const { creditBalance } = useBilling()
  const scopedOrders = dataScope.scope(orders)
  const { today } = dashboardStats
  const visibleActions = quickActions.filter(a => can(a.perm))
  const contact = customer?.contact ?? '客户'
  const customerCode = customer?.code ?? '—'
  const warehouse = customer?.warehouse ?? '—'

  return (
    <div className="page-shell space-y-5">
      {/* Buffalo WMS 欢迎横幅 */}
      <div className="overflow-hidden rounded-xl bg-gradient-to-r from-[#d32f2f] to-[#b71c1c] text-white shadow-lg">
        <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-white/80">Overseas Warehouse System · 欢迎页</p>
            <h1 className="mt-1 text-2xl font-semibold">
              {role === 'sys_admin' ? 'OMS 运营后台' : `你好，${contact.split(' ')[0]} 👋`}
            </h1>
            <p className="mt-2 text-sm text-white/85">
              {dataScope.isAdmin
                ? `全平台 ${scopedOrders.length} 单 · ${dataScope.customerOptions.length} 个活跃客户`
                : `${customerCode} · ${ROLE_LABELS[role]} · ${warehouse}`}
            </p>
          </div>
          <div className="flex gap-4 rounded-xl bg-white/10 px-5 py-3 backdrop-blur-sm">
            <div className="text-center">
              <p className="text-2xl font-bold">{formatCurrency(creditBalance)}</p>
              <p className="text-[11px] text-white/70">账户余额</p>
            </div>
            <div className="w-px bg-white/20" />
            <div className="text-center">
              <p className="text-2xl font-bold">{today.newOrders}</p>
              <p className="text-[11px] text-white/70">今日订单</p>
            </div>
            <div className="w-px bg-white/20" />
            <div className="text-center">
              <p className="text-2xl font-bold text-amber-200">{today.exceptions}</p>
              <p className="text-[11px] text-white/70">待处理异常</p>
            </div>
          </div>
        </div>
      </div>

      {/* 快捷入口 */}
      <div>
        <p className="mb-3 text-sm font-semibold text-text-primary">常用功能</p>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {visibleActions.map(action => (
            <Link
              key={action.to}
              to={action.to}
              className={`relative flex flex-col items-center gap-2 rounded-xl p-4 ring-1 transition-all hover:-translate-y-0.5 hover:shadow-md ${action.color}`}
            >
              <action.icon className="h-6 w-6" />
              <span className="text-xs font-medium">{action.label}</span>
              {action.badge !== undefined && action.badge > 0 && (
                <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">{action.badge}</span>
              )}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* 待办事项 */}
        <Card className="lg:col-span-2">
          <CardHeader title="待办事项" desc="需您关注处理的业务" action={
            <Link to="/messages" className="text-xs font-medium text-primary-600 hover:underline">全部消息</Link>
          } />
          <div className="grid gap-3 p-5 pt-0 sm:grid-cols-2">
            {[
              { label: '在途入库', count: welcomePending.inboundOnWay, to: '/inbound/records?tab=on_the_way', show: can('inbound:read') },
              { label: '待发货出库', count: welcomePending.outboundPending, to: '/outbound/records?tab=active', show: can('outbound:read') || can('order:read') },
              { label: '库存预警', count: welcomePending.inventoryAlerts, to: '/inventory/alerts', show: can('inventory:read'), alert: true },
              { label: '未读消息', count: welcomePending.unreadMessages, to: '/messages', show: true },
            ].filter(i => i.show).map(item => (
              <Link
                key={item.label}
                to={item.to}
                className={`flex items-center justify-between rounded-xl px-4 py-3 ring-1 transition-colors hover:bg-surface-muted ${
                  item.alert && item.count > 0 ? 'bg-red-50 ring-red-100' : 'bg-white ring-border-light'
                }`}
              >
                <div className="flex items-center gap-2">
                  {item.alert && item.count > 0 && <AlertTriangle className="h-4 w-4 text-red-500" />}
                  <span className="text-sm text-text-primary">{item.label}</span>
                </div>
                <span className={`text-lg font-bold ${item.alert && item.count > 0 ? 'text-red-600' : 'text-primary-600'}`}>{item.count}</span>
              </Link>
            ))}
          </div>
        </Card>

        {/* 系统公告 */}
        <Card>
          <CardHeader title="系统公告" />
          <ul className="divide-y divide-border-light px-2 pb-2">
            {announcements.map(a => (
              <li key={a.id} className="flex items-start gap-2 px-3 py-3">
                <FileText className={`mt-0.5 h-4 w-4 shrink-0 ${a.type === 'important' ? 'text-red-500' : 'text-text-muted'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-text-primary">{a.title}</p>
                  <p className="mt-0.5 text-[10px] text-text-muted">{a.date}</p>
                </div>
                {a.type === 'important' && (
                  <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[9px] font-semibold text-red-600">重要</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* 最近业务：出库与订单已合并，只保留入库 + 出库 */}
      <div className="grid gap-5 lg:grid-cols-2">
        {can('inbound:read') && (
          <Card>
            <CardHeader title="最近入库" action={<Link to="/inbound/records" className="text-xs text-primary-600 hover:underline">更多</Link>} />
            <ul className="divide-y divide-border-light px-5 pb-3">
              {dataScope.scope(inboundOrders).slice(0, 3).map(o => (
                <li key={o.id} className="flex items-center justify-between py-2.5 text-xs">
                  <MonoCode>{o.inboundNo}</MonoCode>
                  <Badge status={o.status} />
                </li>
              ))}
            </ul>
          </Card>
        )}
        {(can('outbound:read') || can('order:read')) && (
          <Card>
            <CardHeader title="最近出库" action={<Link to="/outbound/records" className="text-xs text-primary-600 hover:underline">更多</Link>} />
            <ul className="divide-y divide-border-light px-5 pb-3">
              {dataScope.scopeOutbound(outboundOrders).slice(0, 3).map(o => (
                <li key={o.id} className="flex items-center justify-between py-2.5 text-xs">
                  <MonoCode>{o.outboundNo}</MonoCode>
                  <Badge status={o.status} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {/* 仓库信息 */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-4 bg-surface-muted/50 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100">
            <Warehouse className="h-5 w-5 text-primary-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-text-primary">当前默认仓库 · jhb1</p>
            <p className="text-xs text-text-muted">Johannesburg · TKL Overseas Warehouse · 南非时区 UTC+2</p>
          </div>
        </div>
      </Card>
    </div>
  )
}
