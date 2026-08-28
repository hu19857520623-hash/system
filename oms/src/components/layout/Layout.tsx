import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import {
  LayoutDashboard, ShoppingCart, Package, AlertTriangle, MapPin,
  RotateCcw, Receipt, CreditCard, BarChart3, Bell, LogOut,
  Boxes, Link2, ArrowDownToLine, ArrowUpFromLine, Layers, Search, Users,
  ChevronDown, ChevronUp, ClipboardList, FileCheck, Truck, Wallet,
  MonitorCog,
} from 'lucide-react'
import { formatCurrency, countOrdersByTab, warehouseLabel } from '../../data/mockData'
import { useCustomerProfile, useOrders } from '../../data/entityStore'
import { useBilling } from '../../data/billingStore'
import { useRole } from '../../auth/RoleContext'
import { useDataScope } from '../../auth/useDataScope'
import { isSysAdmin } from '../../data/dataScope'
import RoleSwitcher from '../auth/RoleSwitcher'
import { startErpAutoSync } from '../../data/erpAutoSync'
import { ToastHost } from '../ui/ToastHost'

interface NavItem {
  to: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
  badge?: number
  end?: boolean
}

interface NavAccordion {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  items: NavItem[]
}

/** 参考 Buffalo OMS 左侧 accordion：点击一级菜单展开子操作 */
const accordionNav: NavAccordion[] = [
  {
    id: 'dashboard',
    label: '首页',
    icon: LayoutDashboard,
    items: [{ to: '/', label: '首页看板', icon: LayoutDashboard, end: true }],
  },
  {
    id: 'inbound',
    label: '入库',
    icon: ArrowDownToLine,
    items: [
      { to: '/inbound', label: '预约入库', icon: ClipboardList, end: true },
      { to: '/inbound/records', label: '入库记录', icon: FileCheck, end: true },
      { to: '/inbound/qc', label: '质检报告', icon: FileCheck, end: true },
    ],
  },
  {
    id: 'outbound',
    label: '出库',
    icon: ArrowUpFromLine,
    items: [
      {
        to: '/outbound/records', label: '订单与出库', icon: ShoppingCart, end: true,
      },
      { to: '/outbound', label: '预约发货', icon: Truck, end: true },
    ],
  },
  {
    id: 'returns',
    label: '退件',
    icon: RotateCcw,
    items: [
      { to: '/returns/apply', label: '预约退件', icon: ClipboardList, end: true },
      { to: '/returns/processing', label: '退件处理', icon: FileCheck, end: true },
    ],
  },
  {
    id: 'inventory',
    label: '库存',
    icon: Package,
    items: [
      { to: '/inventory', label: '库存查询', icon: Package, end: true },
      { to: '/inventory/alerts', label: '库存预警', icon: AlertTriangle, end: true, badge: 3 },
    ],
  },
  {
    id: 'billing',
    label: '费用管理',
    icon: Wallet,
    items: [
      { to: '/billing', label: '费用账单', icon: Receipt, end: true },
      { to: '/billing/recharge', label: '账户充值', icon: CreditCard, end: true },
      { to: '/reports', label: '报表中心', icon: BarChart3, end: true },
    ],
  },
  {
    id: 'products',
    label: '商品管理',
    icon: Boxes,
    items: [
      { to: '/catalog', label: '货盘选品', icon: Layers, end: true },
      { to: '/codes', label: '编码与绑定', icon: Link2, end: true },
      { to: '/products', label: '我的商品', icon: Boxes, end: true },
    ],
  },
  {
    id: 'messages',
    label: '消息中心',
    icon: Bell,
    items: [{ to: '/messages', label: '系统消息', icon: Bell, end: true, badge: 2 }],
  },
  {
    id: 'system',
    label: '系统管理',
    icon: MonitorCog,
    items: [
      { to: '/accounts', label: '账号管理', icon: Users, end: true },
      { to: '/system/price-template', label: '价格模板', icon: Receipt, end: true },
      { to: '/system/region-template', label: '地区模板', icon: MapPin, end: true },
    ],
  },
]

const allNavItems = accordionNav.flatMap(g => g.items)

function findPageTitle(pathname: string): string {
  const exact = allNavItems.find(i => pathname === i.to)
  if (exact) return exact.label
  const sorted = [...allNavItems].filter(i => i.to !== '/').sort((a, b) => b.to.length - a.to.length)
  for (const item of sorted) {
    if (pathname.startsWith(item.to + '/')) return item.label
  }
  if (pathname.endsWith('/edit')) return '修改产品'
  if (/^\/products\/[^/]+$/.test(pathname)) return '产品详情'
  return '首页看板'
}

function groupContainsPath(group: NavAccordion, pathname: string): boolean {
  return group.items.some(item => {
    if (item.to === '/') return pathname === '/'
    return pathname === item.to || pathname.startsWith(item.to + '/')
  })
}

export default function Layout() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const {
    canAccessRoute,
    roleLabel,
    role,
    accounts,
    isLoggedIn,
    userName,
    userEmail,
    warehouse: sessionWarehouse,
    logout,
  } = useRole()
  const dataScope = useDataScope()
  const admin = isSysAdmin(role)
  const pageTitle = findPageTitle(pathname)
  const [menuSearch, setMenuSearch] = useState('')
  const orders = useOrders()
  const customer = useCustomerProfile()
  const { creditBalance } = useBilling()
  const activeAccount = dataScope.activeCustomerId
    ? accounts.find(a => a.id === dataScope.activeCustomerId)
    : undefined
  const customerCode = admin ? '—' : dataScope.activeCustomerCode
  const warehouse = activeAccount?.warehouse
    ? warehouseLabel(activeAccount.warehouse)
    : sessionWarehouse
      ? warehouseLabel(sessionWarehouse)
    : customer?.warehouse
      ? warehouseLabel(customer.warehouse)
      : '—'
  const contact = activeAccount?.contact || userName || customer?.contact || userEmail || '客户'

  // ERP 履约状态自动回传：进入系统后每 15s / 窗口聚焦时静默同步
  useEffect(() => startErpAutoSync(role), [role])

  const navGroups = useMemo(() => accordionNav.map(group => ({
    ...group,
    items: group.items.map(item => {
      if (item.to === '/outbound/records') {
        return {
          ...item,
          badge: countOrdersByTab('pending_ship', orders) + countOrdersByTab('exception', orders),
        }
      }
      return item
    }),
  })), [orders])

  const visibleGroups = useMemo(() => navGroups
    .map(group => ({
      ...group,
      items: group.items.filter(item => canAccessRoute(item.to)),
    }))
    .filter(group => group.items.length > 0)
    .map(group => ({
      ...group,
      items: menuSearch.trim()
        ? group.items.filter(i => i.label.includes(menuSearch.trim()) || group.label.includes(menuSearch.trim()))
        : group.items,
    }))
    .filter(group => group.items.length > 0),
  [canAccessRoute, menuSearch, navGroups])

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const g of accordionNav) {
      init[g.id] = groupContainsPath(g, pathname)
    }
    return init
  })

  useEffect(() => {
    if (!isLoggedIn) {
      navigate('/login', { replace: true })
      return
    }
    if (!canAccessRoute(pathname)) navigate('/', { replace: true })
  }, [pathname, canAccessRoute, navigate, isLoggedIn])

  useEffect(() => {
    setExpanded(prev => {
      const next = { ...prev }
      for (const g of accordionNav) {
        if (groupContainsPath(g, pathname)) next[g.id] = true
      }
      return next
    })
  }, [pathname])

  const toggleGroup = (id: string) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  if (!isLoggedIn) return null

  return (
    <div className="flex h-screen overflow-hidden bg-surface-muted">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-white">
        {/* 红色顶栏 — 参考 Buffalo OMS */}
        <div className="flex h-12 items-center gap-2 bg-[#d32f2f] px-4">
          <img src="/ketuo-logo.png" alt="特柯洛海外仓" className="h-7 w-7 rounded-full object-cover ring-1 ring-white/30" />
          <p className="text-sm font-semibold text-white">OMS-订单管理系统</p>
        </div>

        {/* 用户信息 */}
        <div className="flex items-center gap-2 border-b border-border-light px-3 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold text-text-secondary">
            {admin ? 'AD' : contact.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-text-primary">
              {admin ? 'OMS 系统管理员' : customerCode}
            </p>
            <p className="truncate text-[10px] text-text-muted">
              {admin ? `全平台 · ${accounts.filter(a => a.status === 'active').length} 个客户` : roleLabel}
            </p>
          </div>
        </div>

        {/* 菜单搜索 */}
        <div className="border-b border-border-light px-3 py-2">
          <div className="relative">
            <Search className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              value={menuSearch}
              onChange={e => setMenuSearch(e.target.value)}
              placeholder="搜索菜单"
              className="w-full rounded border border-border bg-white py-1.5 pl-2.5 pr-8 text-xs placeholder:text-text-muted focus:border-primary-400 focus:outline-none"
            />
          </div>
        </div>

        {/* Accordion 导航 */}
        <nav className="flex-1 overflow-y-auto scrollbar-thin py-1">
          {visibleGroups.map(group => {
            const isOpen = expanded[group.id] ?? false
            const hasActive = groupContainsPath(group, pathname)
            const isSingle = group.items.length === 1 && group.id === 'dashboard'

            if (isSingle) {
              const item = group.items[0]
              return (
                <NavLink
                  key={group.id}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `mx-2 my-0.5 flex items-center gap-2.5 rounded px-3 py-2.5 text-sm transition-colors ${
                      isActive ? 'bg-primary-50 text-primary-700 font-medium' : 'text-text-secondary hover:bg-surface-muted'
                    }`
                  }
                >
                  <group.icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">{item.badge}</span>
                  )}
                </NavLink>
              )
            }

            return (
              <div key={group.id} className="border-b border-border-light/60 last:border-0">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors hover:bg-surface-muted ${
                    hasActive ? 'text-primary-700 font-medium' : 'text-text-primary'
                  }`}
                >
                  <group.icon className="h-4 w-4 shrink-0 text-text-secondary" />
                  <span className="flex-1">{group.label}</span>
                  {isOpen
                    ? <ChevronUp className="h-3.5 w-3.5 text-text-muted" />
                    : <ChevronDown className="h-3.5 w-3.5 text-text-muted" />}
                </button>

                {isOpen && (
                  <ul className="pb-1">
                    {group.items.map(item => (
                      <li key={item.to + item.label}>
                        <NavLink
                          to={item.to}
                          end={item.end}
                          className={({ isActive }) =>
                            `mx-2 flex items-center gap-2 rounded py-2 pl-9 pr-3 text-xs transition-colors ${
                              isActive
                                ? 'bg-primary-50 text-primary-700 font-medium border-l-2 border-primary-500 -ml-0 pl-[calc(2.25rem-2px)]'
                                : 'text-text-secondary hover:bg-surface-muted hover:text-text-primary'
                            }`
                          }
                        >
                          {item.icon && <item.icon className="h-3.5 w-3.5 shrink-0 opacity-70" />}
                          <span className="flex-1">{item.label}</span>
                          {item.badge !== undefined && item.badge > 0 && (
                            <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-semibold text-white">{item.badge}</span>
                          )}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </nav>

        <div className="border-t border-border-light p-3">
          <div className="rounded-lg bg-surface-muted/80 px-3 py-2.5">
            {roleLabel === '系统管理员' ? (
              <p className="text-[11px] text-text-muted">管理 {accounts.length} 个客户账号</p>
            ) : (
              <p className="text-xs font-semibold text-primary-700">{formatCurrency(creditBalance)}</p>
            )}
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-white px-6">
          <div>
            <p className="text-base font-semibold text-text-primary">{pageTitle}</p>
            <p className="text-[11px] text-text-muted">
              {admin ? `全平台数据 · ${dataScope.activeCustomerCode}` : `${roleLabel} · ${warehouse}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {admin && <RoleSwitcher />}
            <Link
              to="/messages"
              className="relative rounded-lg p-2 text-text-secondary hover:bg-surface-muted"
              aria-label="通知"
            >
              <Bell className="h-[18px] w-[18px]" />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-red-500" />
            </Link>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700">
              {admin ? '管' : contact[0]}
            </div>
            <button
              type="button"
              className="rounded-lg p-2 text-text-secondary hover:bg-surface-muted"
              title="退出登录"
              onClick={() => { void logout(); navigate('/login') }}
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </header>

        <main className="content-bg flex-1 overflow-y-auto scrollbar-thin p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
      <ToastHost />
    </div>
  )
}
