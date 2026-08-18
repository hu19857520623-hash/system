import { defineStore } from 'pinia'
import { authApi } from '@/api/client'
import { clearAccessToken, getAccessToken, setAccessToken } from '@/auth/tokenStore'
import {
  ROLE_PERM_TEMPLATES,
  templatePermsForRoleName,
} from '@erp/shared/permissions.catalog'

const DEFAULT_PASSWORD = '123456'

function mapRoleCodeToFrontendRole(roleCode: string, roleName?: string): string {
  if (roleName?.includes('开发主管')) return '产品开发主管'
  const map: Record<string, string> = {
    admin: '系统管理员',
    ops_manager: '采购主管',
    purchaser: '采购',
    finance: '财务',
    cs: '销售',
    sales_manager: '销售主管',
    coach: '陪跑',
    coach1: '陪跑1',
    coach2: '陪跑2',
    viewer: '产品开发',
    warehouse: '仓库',
    dev_manager: '产品开发主管',
  }
  return map[roleCode] || roleName || '系统管理员'
}

export interface AuthUser {
  id: number
  username: string
  realName: string
  roleCode: string
  roleName?: string
  phone?: string | null
  email?: string | null
  permissions?: string[]
}

export interface Account {
  id: string
  login: string
  name: string
  role: string
  status: string
  lastLogin: string
}

export interface NavItem {
  id: string
  name: string
  badgeKey?: string
}

export type NavChannel = 'domestic' | 'overseas_wms'

export interface NavGroup {
  label: string
  items: NavItem[]
  /** 业务渠道：国内供应链 vs 海外仓内部作业 */
  channel?: NavChannel
}

export const NAV_CHANNEL_LABELS: Record<NavChannel, string> = {
  domestic: '国内供应链',
  overseas_wms: '海外仓作业',
}

const ACCOUNTS: Account[] = [
  { id: 'ACC-001', login: 'admin', name: '系统管理员', role: '系统管理员', status: 'ok', lastLogin: '刚刚' },
  { id: 'ACC-002', login: 'zhaomin', name: '赵敏', role: '采购主管', status: 'ok', lastLogin: '09:12' },
  { id: 'ACC-003', login: 'liuyang', name: '刘洋', role: '产品开发主管', status: 'ok', lastLogin: '昨天' },
  { id: 'ACC-006', login: 'zhoujie', name: '周杰', role: '产品开发', status: 'ok', lastLogin: '06-11' },
  { id: 'ACC-007', login: 'sunhao', name: '孙浩', role: '采购', status: 'ok', lastLogin: '06-10' },
  { id: 'ACC-004', login: 'linxinyi', name: '林心仪', role: '销售', status: 'ok', lastLogin: '09:30' },
  { id: 'ACC-005', login: 'wangfang', name: '王芳', role: '财务', status: 'ok', lastLogin: '06-09' },
  { id: 'ACC-008', login: 'chenqi', name: '陈琪', role: '陪跑', status: 'ok', lastLogin: '08:45' },
]

const NAV: NavGroup[] = [
  {
    label: '概览',
    items: [{ id: 'dashboard', name: '工作台' }],
  },
  {
    label: '获客与销售',
    items: [
      { id: 'leads_pool', name: '线索池' },
      { id: 'leads_follow', name: '我的跟进', badgeKey: 'leads_follow' },
      { id: 'leads_deals', name: '成交管理' },
      { id: 'leads_reports', name: '获客报表' },
    ],
  },
  {
    label: '商品与选品',
    items: [
      { id: 'products', name: '商品主数据' },
      { id: 'product_dev', name: '产品开发' },
      { id: 'product_audit', name: '产品审核', badgeKey: 'product_audit' },
    ],
  },
  {
    label: '采购',
    channel: 'domestic',
    items: [
      { id: 'suppliers', name: '供应商管理' },
      { id: 'purchase', name: '采购订单', badgeKey: 'purchase' },
    ],
  },
  {
    label: '物流中转',
    channel: 'domestic',
    items: [
      { id: 'logistics_wh', name: '物流中转仓', badgeKey: 'logistics_wh' },
      { id: 'logistics_inventory', name: '中转仓库存查询' },
      { id: 'mingrui', name: '明瑞物流下单', badgeKey: 'mingrui' },
      { id: 'create_inbound', name: '发运海外仓' },
    ],
  },
  {
    label: '仓储作业',
    channel: 'overseas_wms',
    items: [
      { id: 'warehouse_locations', name: '库位管理' },
      { id: 'inbound_arrival', name: '到仓扫描', badgeKey: 'inbound_in_transit' },
      { id: 'inbound', name: '入库单管理', badgeKey: 'inbound_receipt' },
      { id: 'returns', name: '退件管理' },
      { id: 'outbound', name: '出库单管理', badgeKey: 'outbound' },
      { id: 'inventory_query', name: '库存查询' },
      { id: 'sku_query', name: 'SKU 查询' },
    ],
  },
  {
    label: '同步',
    items: [
      { id: 'sync', name: '同步日志', badgeKey: 'sync' },
      { id: 'operation_log', name: '操作日志' },
    ],
  },
  {
    label: '财务',
    items: [
      { id: 'customers', name: '客户列表' },
      { id: 'billing', name: '客户结算', badgeKey: 'billing' },
      { id: 'budget_credit', name: '客户充值' },
      { id: 'receivable_payable', name: '供应商海运账单' },
      { id: 'cost', name: '成本台账' },
      { id: 'profit_analysis', name: '利润/采购分析' },
    ],
  },
  {
    label: '运营',
    items: [
      { id: 'pricing', name: '货盘库存', badgeKey: 'pricing' },
      { id: 'store_monitor', name: '店铺监控' },
    ],
  },
]

const NAV_ROUTE_MAP: Record<string, string> = {
  dashboard: '/dashboard',
  leads_pool: '/leads/pool',
  leads_follow: '/leads/follow',
  leads_deals: '/leads/deals',
  leads_reports: '/leads/reports',
  products: '/products',
  product_dev: '/product-dev',
  product_audit: '/product-audit',
  suppliers: '/suppliers',
  purchase: '/purchase',
  logistics_wh: '/logistics-wh',
  logistics_inventory: '/logistics-inventory',
  mingrui: '/mingrui',
  warehouse_locations: '/warehouse/locations',
  inbound_arrival: '/inbound/arrival-scan',
  create_inbound: '/inbound/create',
  inbound: '/inbound/receipt',
  returns: '/returns',
  inbound_putaway: '/inbound/arrival-scan?step=putaway',
  outbound: '/outbound',
  pricing: '/pricing',
  inventory_query: '/inventory',
  sku_query: '/inventory/sku-query',
  cost: '/cost',
  sync: '/sync',
  operation_log: '/operation-logs',
  billing: '/billing',
  customers: '/customers',
  receivable_payable: '/supplier-freight',
  reports: '/profit-analysis',
  store_monitor: '/store-monitor',
  profit_analysis: '/profit-analysis',
  budget_credit: '/customer-recharge',
  async_io: '/async-io',
  permissions: '/permissions',
  user_management: '/permissions',
}

const ROLE_TEMPLATES = ROLE_PERM_TEMPLATES

export const useAppStore = defineStore('app', {
  state: () => ({
    authReady: false,
    isAuthenticated: false,
    authenticatedUser: null as AuthUser | null,
    currentAccountId: 'ACC-001',
    accounts: ACCOUNTS,
    nav: NAV,
    navRouteMap: NAV_ROUTE_MAP,
    roleTemplates: ROLE_TEMPLATES,
    permOverrides: {} as Record<string, string[]>,
    userPermOverrides: (() => {
      try {
        return JSON.parse(localStorage.getItem('userPermOverrides') || '{}') as Record<string, string[]>
      } catch {
        return {}
      }
    })(),
  }),
  getters: {
    currentAccount(state): Account {
      if (state.authenticatedUser) {
        const u = state.authenticatedUser
        const matched = state.accounts.find((a) => a.login === u.username)
        const role = mapRoleCodeToFrontendRole(u.roleCode, u.roleName)
        if (matched) {
          return { ...matched, name: u.realName || matched.name, role }
        }
        return {
          id: `U-${u.id}`,
          login: u.username,
          name: u.realName || u.username,
          role,
          status: 'ok',
          lastLogin: '刚刚',
        }
      }
      return state.accounts.find(a => a.id === state.currentAccountId) || state.accounts[0]
    },
    currentRole(): string {
      return (this as any).currentAccount.role
    },
    currentPermSet(state): Set<string> {
      const auth = state.authenticatedUser
      if (auth) {
        if (auth.permissions?.length) return new Set(auth.permissions)
        const role = mapRoleCodeToFrontendRole(auth.roleCode, auth.roleName)
        return new Set((this as any).templatePermsForRole(role))
      }
      const acct = state.accounts.find(a => a.id === state.currentAccountId)
      const override = state.permOverrides[state.currentAccountId]
      if (override?.length) return new Set(override)
      return new Set(state.roleTemplates[acct?.role || '系统管理员'] || [])
    },
    /** 按岗位权限过滤后的侧栏菜单（空分组自动隐藏） */
    visibleNav(): NavGroup[] {
      return this.nav
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => (this as any).canViewScreen(item.id)),
        }))
        .filter((group) => group.items.length > 0)
    },
  },
  actions: {
    applyAuthUser(user: AuthUser) {
      this.authenticatedUser = user
      this.isAuthenticated = true
      const matched = this.accounts.find((a) => a.login === user.username)
      this.currentAccountId = matched?.id ?? `U-${user.id}`
    },
    applyProfile(profile: {
      id: number
      username: string
      realName: string
      roleCode: string
      roleName?: string
      phone?: string | null
      email?: string | null
      permissions?: string[]
    }) {
      this.applyAuthUser({
        id: profile.id,
        username: profile.username,
        realName: profile.realName,
        roleCode: profile.roleCode,
        roleName: profile.roleName,
        phone: profile.phone,
        email: profile.email,
        permissions: profile.permissions,
      })
    },
    async initAuth() {
      if (this.authReady) return this.isAuthenticated
      const token = getAccessToken()
      if (!token) {
        this.authReady = true
        return false
      }
      try {
        const profile = await authApi.profile()
        this.applyProfile(profile)
      } catch {
        clearAccessToken()
        this.authenticatedUser = null
        this.isAuthenticated = false
      } finally {
        this.authReady = true
      }
      return this.isAuthenticated
    },
    async login(username: string, password: string) {
      const res = await authApi.login({ username, password })
      if (!res?.token) throw new Error('登录失败')
      setAccessToken(res.token)
      const profile = await authApi.profile()
      this.applyProfile(profile)
    },
    async refreshProfile() {
      const profile = await authApi.profile()
      this.applyProfile(profile)
    },
    logout() {
      clearAccessToken()
      this.authenticatedUser = null
      this.isAuthenticated = false
      this.currentAccountId = 'ACC-001'
    },
    async loginForAccount(accountId?: string) {
      const id = accountId || this.currentAccountId
      const acct = this.accounts.find(a => a.id === id)
      if (!acct?.login) return
      try {
        await this.login(acct.login, DEFAULT_PASSWORD)
      } catch {
        /* 后端未启动时静默失败 */
      }
    },
    async switchAccount(id: string) {
      this.currentAccountId = id
      await this.loginForAccount(id)
    },
    hasPerm(permId: string): boolean {
      if (this.authenticatedUser?.roleCode === 'admin') return true
      return this.currentPermSet.has(permId)
    },
    getPermsForUser(userId: string | number, roleName: string): string[] {
      const key = String(userId)
      if (this.userPermOverrides[key]?.length) return this.userPermOverrides[key]
      return this.templatePermsForRole(roleName)
    },
    setUserPermOverride(userId: string | number, perms: string[]) {
      const key = String(userId)
      this.userPermOverrides[key] = perms
      localStorage.setItem('userPermOverrides', JSON.stringify(this.userPermOverrides))
    },
    templatePermsForRole(roleName: string): string[] {
      return templatePermsForRoleName(roleName)
    },
    canViewScreen(screenId: string): boolean {
      if (this.authenticatedUser?.roleCode === 'admin') return true
      const permMap: Record<string, string | string[]> = {
        leads_pool: 'leads_pool.view',
        leads_follow: 'leads_follow.view',
        leads_deals: 'leads_deals.view',
        leads_reports: 'leads_reports.view',
        products: 'products.view',
        product_dev: 'product_dev.view',
        product_audit: 'product_audit.view',
        suppliers: 'suppliers.view',
        purchase: 'purchase.view',
        logistics_wh: 'logistics_wh.view',
        logistics_inventory: 'logistics_wh.view',
        mingrui: 'mingrui.view',
        warehouse_locations: 'warehouse_location.view',
        inbound_arrival: 'inbound.arrival_scan',
        create_inbound: 'create_inbound.view',
        inbound: 'inbound.view',
        returns: 'return.view',
        inbound_putaway: 'inbound.view',
        outbound: 'outbound.view',
        pricing: 'pricing.view',
        inventory_query: 'inventory_query.view',
        sku_query: 'inventory_query.view',
        cost: 'cost.view',
        sync: 'sync.view',
        operation_log: 'operation_log.view',
        billing: 'billing.view',
        customers: ['budget_credit.view', 'billing.view'],
        receivable_payable: 'receivable_payable.view',
        reports: ['reports.view', 'profit_analysis.view'],
        store_monitor: 'store_monitor.view',
        profit_analysis: ['profit_analysis.view', 'reports.view'],
        budget_credit: 'budget_credit.view',
        async_io: ['async_io.import', 'async_io.export'],
        permissions: 'permissions.view',
        user_management: 'permissions.view',
      }
      const perm = permMap[screenId]
      if (!perm) return true // dashboard
      if (Array.isArray(perm)) return perm.some(p => this.hasPerm(p))
      return this.hasPerm(perm)
    },
  },
})
