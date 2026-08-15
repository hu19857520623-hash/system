export type FulfillmentStatus =
  | 'pending_payment' | 'pending_review' | 'pending_ship'
  | 'processing' | 'shipped_out' | 'in_transit' | 'delivered' | 'exception' | 'cancelled'

export type ExceptionType = 'stock_short' | 'address_error' | 'logistics_fail' | 'sync_fail' | null

export interface OrderItem {
  sku: string
  name: string
  qty: number
  price: number
  stockOk: boolean
}

export interface Order {
  id: string
  orderNo: string
  customerId?: string
  platform: 'Takealot' | 'Manual' | 'Shopify'
  store: string
  country: string
  countryCode: string
  skuCount: number
  warehouse: string
  logistics: string
  status: FulfillmentStatus
  exception: ExceptionType
  /** 异常自由文本备注 */
  exceptionReason?: string
  amount: number
  createdAt: string
  recipient: string
  address: string
  items: OrderItem[]
  tracking: { time: string; desc: string; location?: string }[]
  fees: { type: string; amount: number }[]
  logs: { time: string; action: string; user: string }[]
}

export const TAKEALOT_ATTACHMENT_KINDS = {
  outerLabel: 'outerLabel',
  skuLabel: 'skuLabel',
  deliveryList: 'deliveryList',
  appointment: 'appointment',
} as const

export type TakealotAttachmentKind =
  typeof TAKEALOT_ATTACHMENT_KINDS[keyof typeof TAKEALOT_ATTACHMENT_KINDS]

export const TAKEALOT_ATTACHMENT_KIND_LABELS: Record<TakealotAttachmentKind, string> = {
  outerLabel: '外箱标',
  skuLabel: 'SKU 标签',
  deliveryList: '发货清单',
  appointment: '预约单',
}

/** 入库/出库附件 */
export interface FileAttachment {
  kind: string
  /** ERP/API 使用的稳定类型；Takealot 使用 outerLabel / skuLabel / deliveryList / appointment。 */
  fileType?: TakealotAttachmentKind | string
  fileName: string
  url: string
  uploadedAt: string
  sku?: string
  platformBarcode?: string
  unitIndex?: number
  sourcePage?: number
  sourceRow?: number
  sourceColumn?: number
  labelRole?: 'sourceDocument' | 'unitCrop' | string
  /** 大附件后续迁移到 IndexedDB/本地文件存储时使用。 */
  localStorageRef?: string
  localStorageKey?: string
  /** ERP 附件 id（同步后可经 BFF 下载） */
  erpAttachmentId?: number
}

export interface OutboundLineItem {
  sku: string
  name: string
  qty: number
  declaredName?: string
  declaredValue?: number
  note?: string
}

export interface InboundLineItem {
  sku: string
  name: string
  qty: number
  boxNo: number
  packType?: string
  stockType?: string
}

export interface InventoryItem {
  id: string
  customerId?: string
  sku: string
  name: string
  image: string
  available: number
  locked: number
  inTransit: number
  safetyStock: number
  spec: string
  customCode?: string
  ean?: string
  warehouse: string
  pendingShelving: number
  pendingOutbound: number
  defective: number
  shipped: number
  warningQty: number
  price: number
  declaredNameEn?: string
  categoryPath?: string
  /** 库存来源：自有建档入库 vs 货盘选品入库 */
  stockSource: StockSource
}

export interface FeeRecord {
  id: string
  date: string
  type: 'storage' | 'handling' | 'shipping' | 'relabel' | 'picking' | 'inspection' | 'other' | 'recharge'
  refNo: string
  desc: string
  amount: number
  /** 预扣款 vs 实际结算 vs 对账调整 */
  method?: 'pre_deduct' | 'actual' | 'settlement_adjust'
  /** 充值记录：客户编码 */
  customerCode?: string
  /** 充值记录：充值编号（优先于 refNo） */
  rechargeNo?: string
  /** 充值记录：支付方式 */
  paymentMethodId?: string
  paymentMethodTitle?: string
}

export const CUSTOMER = {
  name: '南非优选贸易',
  code: 'TKL0001',
  contact: 'David Nkosi',
  warehouse: '约翰内斯堡 jhb1',
  creditBalance: 48500,
  monthlySpent: 11930,
  pendingBill: 3280,
  budgetUsed: 62,
}

import type { Permission } from '../auth/permissions'

export interface CustomerAccount {
  id: string
  name: string
  companyName?: string | null
  code: string
  type: 'ecommerce' | 'catalog' | 'hybrid'
  contact: string
  contactPhone?: string | null
  email: string
  status: 'active' | 'disabled'
  permissions: Permission[]
  warehouse: string
  createdAt: string
  lastLoginAt: string
  portalUser?: {
    loginEmail: string
    status: string
    mustChangePassword: boolean
    lastLoginAt?: string | null
  } | null
  /** @deprecated 请使用 priceTemplateByRegion */
  priceTemplateId?: string | null
  /** 按收货地区（jhb/cpt/dbn）绑定的价格模板 */
  priceTemplateByRegion?: Partial<Record<string, string | null>>
}

export const customerAccounts: CustomerAccount[] = [
  {
    id: 'tkl', name: '平台货盘', code: 'TKL', type: 'catalog',
    contact: '系统', email: 'catalog@platform.local', status: 'active',
    permissions: ['dashboard:read', 'catalog:read', 'inventory:read'],
    warehouse: 'jhb1', createdAt: '2025-01-01', lastLoginAt: '—',
  },
  {
    id: '1', name: '南非优选贸易', code: 'TKL0001', type: 'ecommerce',
    contact: 'David Nkosi', email: 'david@sa-trade.co.za', status: 'active',
    permissions: [
      'dashboard:read', 'order:read', 'order:write', 'order:export',
      'product:read', 'product:write', 'code:read', 'code:apply',
      'inbound:read', 'inbound:write', 'outbound:read', 'outbound:write',
      'inventory:read', 'logistics:read', 'returns:read', 'returns:write',
      'billing:read', 'store:manage', 'report:read',
    ],
    warehouse: 'jhb1', createdAt: '2025-11-12', lastLoginAt: '2026-07-08 09:30',
    priceTemplateByRegion: { jhb: 'pt-jhb-std', cpt: 'pt-cpt-std', dbn: 'pt-dbn-std' },
  },
  {
    // code 与 ERP customer.customer_code 对齐（P0 货盘/余额互通）
    id: '2', name: '开普敦贸易', code: 'TKL0002', type: 'catalog',
    contact: 'John', email: 'sarah@cpt-dist.co.za', status: 'active',
    permissions: [
      'dashboard:read', 'catalog:read', 'catalog:write',
      'product:read', 'code:read', 'inbound:read', 'inbound:write',
      'outbound:read', 'outbound:write', 'inventory:read', 'logistics:read',
      'billing:read', 'report:read',
    ],
    warehouse: 'jhb1', createdAt: '2026-01-20', lastLoginAt: '2026-07-07 16:45',
    priceTemplateByRegion: { jhb: 'pt-jhb-vip', cpt: 'pt-cpt-vip', dbn: 'pt-dbn-vip' },
  },
  {
    id: '3', name: '德班电商', code: 'TKL0003', type: 'ecommerce',
    contact: 'Thabo Mokoena', email: 'thabo@dbn-shop.co.za', status: 'disabled',
    permissions: [
      'dashboard:read', 'order:read', 'order:write', 'product:read',
      'inventory:read', 'billing:read', 'store:manage',
    ],
    warehouse: 'jhb1', createdAt: '2026-03-08', lastLoginAt: '2026-06-15 11:00',
  },
  {
    id: '4', name: '约堡货盘商', code: 'TKL0004', type: 'catalog',
    contact: 'Lisa Pretorius', email: 'lisa@jhb-pallet.co.za', status: 'active',
    permissions: [
      'dashboard:read', 'catalog:read', 'catalog:write', 'product:read',
      'inbound:read', 'inbound:write', 'outbound:read', 'outbound:write',
      'inventory:read', 'logistics:read', 'billing:read',
    ],
    warehouse: 'jhb1', createdAt: '2026-04-15', lastLoginAt: '2026-07-06 10:20',
  },
  {
    id: '5', name: '约翰内斯堡双业态', code: 'TKL0005', type: 'hybrid',
    contact: 'Mike Botha', email: 'mike@jhb-dual.co.za', status: 'active',
    permissions: [
      'dashboard:read',
      'order:read', 'order:write', 'order:export',
      'catalog:read', 'catalog:write',
      'product:read', 'product:write', 'code:read', 'code:apply',
      'inbound:read', 'inbound:write', 'outbound:read', 'outbound:write',
      'inventory:read', 'logistics:read', 'returns:read', 'returns:write',
      'billing:read', 'store:manage', 'report:read',
    ],
    warehouse: 'jhb1', createdAt: '2026-05-22', lastLoginAt: '2026-07-08 08:15',
  },
]

export const orders: Order[] = [
  {
    id: '1', orderNo: 'ORD-260706001', platform: 'Takealot', store: '主店', country: '南非', countryCode: 'ZA',
    skuCount: 1, warehouse: 'jhb1', logistics: '快递', status: 'in_transit', exception: null,
    amount: 890, createdAt: '2026-07-06 09:12', recipient: 'Thabo Mbeki',
    address: '45 Nelson Mandela Blvd, Cape Town 8001, ZA',
    items: [{ sku: 'SKU-JNB-10021', name: '无线蓝牙耳机 Pro', qty: 2, price: 445, stockOk: true }],
    tracking: [
      { time: '2026-07-06 14:30', desc: '包裹已揽收', location: 'Johannesburg' },
      { time: '2026-07-06 18:00', desc: '运输中', location: 'JNB → CPT' },
    ],
    fees: [{ type: '物流费', amount: 45 }, { type: '操作费', amount: 12 }],
    logs: [
      { time: '2026-07-06 09:12', action: '订单同步成功', user: '系统' },
      { time: '2026-07-06 11:00', action: '库存锁定', user: '系统' },
      { time: '2026-07-06 14:30', action: '已出库', user: '系统' },
    ],
  },
  {
    id: '2', orderNo: 'ORD-260706002', platform: 'Takealot', store: '主店', country: '南非', countryCode: 'ZA',
    skuCount: 2, warehouse: 'jhb1', logistics: '卡派', status: 'pending_ship', exception: 'stock_short',
    amount: 450, createdAt: '2026-07-06 08:45', recipient: 'Sarah Johnson',
    address: '12 Main Road, Durban 4001, ZA',
    items: [
      { sku: 'SKU-JNB-10021', name: '无线蓝牙耳机 Pro', qty: 1, price: 289, stockOk: false },
      { sku: 'SKU-JNB-10034', name: 'USB-C 快充数据线', qty: 2, price: 80, stockOk: true },
    ],
    tracking: [],
    fees: [],
    logs: [
      { time: '2026-07-06 08:45', action: '订单同步成功', user: '系统' },
      { time: '2026-07-06 08:46', action: '库存不足：SKU-JNB-10021', user: '系统' },
    ],
  },
  {
    id: '3', orderNo: 'ORD-260705018', platform: 'Manual', store: '—', country: '美国', countryCode: 'US',
    skuCount: 3, warehouse: 'jhb1', logistics: '快递', status: 'delivered', exception: null,
    amount: 1240, createdAt: '2026-07-05 16:20', recipient: 'John Smith',
    address: '789 Oak Ave, Los Angeles, CA 90001, US',
    items: [
      { sku: 'SKU-JNB-10058', name: '手机支架 磁吸款', qty: 2, price: 156, stockOk: true },
      { sku: 'SKU-JNB-10105', name: '运动水杯 750ml', qty: 4, price: 68, stockOk: true },
    ],
    tracking: [
      { time: '2026-07-05 20:00', desc: '已出库', location: 'jhb1' },
      { time: '2026-07-06 02:00', desc: '国际运输中', location: 'JNB → LAX' },
      { time: '2026-07-06 22:00', desc: '已签收', location: 'Los Angeles' },
    ],
    fees: [{ type: '物流费', amount: 280 }, { type: '操作费', amount: 24 }],
    logs: [
      { time: '2026-07-05 16:20', action: '手工订单创建', user: 'David Nkosi' },
      { time: '2026-07-06 22:00', action: '已签收', user: '系统' },
    ],
  },
  {
    id: '4', orderNo: 'ORD-260705012', platform: 'Takealot', store: '副店', country: '南非', countryCode: 'ZA',
    skuCount: 1, warehouse: 'jhb1', logistics: '—', status: 'pending_review', exception: 'address_error',
    amount: 320, createdAt: '2026-07-05 11:30', recipient: 'Unknown',
    address: 'Incomplete address, Pretoria',
    items: [{ sku: 'SKU-JNB-10072', name: '便携榨汁杯 380ml', qty: 1, price: 320, stockOk: true }],
    tracking: [],
    fees: [],
    logs: [
      { time: '2026-07-05 11:30', action: '订单同步成功', user: '系统' },
      { time: '2026-07-05 11:31', action: '地址校验失败', user: '系统' },
    ],
  },
  {
    id: '5', orderNo: 'ORD-260705008', platform: 'Takealot', store: '主店', country: '南非', countryCode: 'ZA',
    skuCount: 1, warehouse: 'jhb1', logistics: '快递', status: 'exception', exception: 'logistics_fail',
    amount: 680, createdAt: '2026-07-05 09:00', recipient: 'Pieter van der Merwe',
    address: '88 Church St, Stellenbosch 7600, ZA',
    items: [{ sku: 'SKU-JNB-10089', name: 'LED 化妆镜 带灯', qty: 2, price: 340, stockOk: true }],
    tracking: [
      { time: '2026-07-05 15:00', desc: '已出库', location: 'jhb1' },
      { time: '2026-07-05 20:00', desc: '物流异常：无法派送', location: 'Stellenbosch' },
    ],
    fees: [{ type: '物流费', amount: 55 }],
    logs: [
      { time: '2026-07-05 09:00', action: '订单同步成功', user: '系统' },
      { time: '2026-07-05 20:00', action: '物流派送失败', user: '系统' },
    ],
  },
  {
    id: '6', orderNo: 'ORD-260704033', platform: 'Takealot', store: '主店', country: '南非', countryCode: 'ZA',
    skuCount: 2, warehouse: 'jhb1', logistics: '卡派', status: 'processing', exception: null,
    amount: 560, createdAt: '2026-07-04 14:22', recipient: 'Nomsa Dlamini',
    address: '23 Oxford Rd, Johannesburg 2196, ZA',
    items: [
      { sku: 'SKU-JNB-10034', name: 'USB-C 快充数据线', qty: 3, price: 45, stockOk: true },
      { sku: 'SKU-JNB-10105', name: '运动水杯 750ml', qty: 5, price: 68, stockOk: true },
    ],
    tracking: [],
    fees: [],
    logs: [
      { time: '2026-07-04 14:22', action: '订单同步成功', user: '系统' },
      { time: '2026-07-04 16:00', action: '仓库处理中', user: '系统' },
    ],
  },
  {
    id: '7', orderNo: 'ORD-260704028', platform: 'Shopify', store: '独立站', country: '英国', countryCode: 'GB',
    skuCount: 1, warehouse: 'jhb1', logistics: '快递', status: 'shipped_out', exception: null,
    amount: 980, createdAt: '2026-07-04 10:15', recipient: 'James Wilson',
    address: '15 Baker St, London W1U 8EW, GB',
    items: [{ sku: 'SKU-JNB-10021', name: '无线蓝牙耳机 Pro', qty: 3, price: 326, stockOk: true }],
    tracking: [{ time: '2026-07-04 18:00', desc: '已出库', location: 'jhb1' }],
    fees: [{ type: '物流费', amount: 320 }],
    logs: [{ time: '2026-07-04 10:15', action: '订单同步成功', user: '系统' }],
  },
  {
    id: '8', orderNo: 'ORD-260703019', platform: 'Takealot', store: '主店', country: '南非', countryCode: 'ZA',
    skuCount: 1, warehouse: 'jhb1', logistics: '—', status: 'pending_payment', exception: null,
    amount: 198, createdAt: '2026-07-03 20:00', recipient: 'Lisa Pretorius',
    address: '5 Long St, Cape Town 8001, ZA',
    items: [{ sku: 'SKU-JNB-10089', name: 'LED 化妆镜 带灯', qty: 1, price: 198, stockOk: true }],
    tracking: [], fees: [],
    logs: [{ time: '2026-07-03 20:00', action: '订单创建，待付款', user: '系统' }],
  },
  {
    id: '9', orderNo: 'ORD-260702011', platform: 'Takealot', store: '副店', country: '南非', countryCode: 'ZA',
    skuCount: 1, warehouse: 'jhb1', logistics: '—', status: 'cancelled', exception: null,
    amount: 128, createdAt: '2026-07-02 16:30', recipient: 'Thabo Mokoena',
    address: '12 Main Rd, Pretoria 0002, ZA',
    items: [{ sku: 'SKU-JNB-10058', name: '手机支架 磁吸款', qty: 1, price: 128, stockOk: true }],
    tracking: [], fees: [],
    logs: [
      { time: '2026-07-02 16:30', action: '订单同步成功', user: '系统' },
      { time: '2026-07-02 18:00', action: '买家取消订单', user: '系统' },
    ],
  },
  {
    id: '10', customerId: '2', orderNo: 'ORD-CPT-260707001', platform: 'Manual', store: '—', country: '南非', countryCode: 'ZA',
    skuCount: 2, warehouse: 'jhb1', logistics: '卡派', status: 'pending_ship', exception: null,
    amount: 520, createdAt: '2026-07-07 10:00', recipient: 'Sarah van Wyk',
    address: '88 Long St, Cape Town 8001, ZA',
    items: [
      { sku: 'CPT-HX6', name: '6双袜（货盘）', qty: 10, price: 35, stockOk: true },
      { sku: 'SKU-JNB-10034', name: 'USB-C 快充数据线', qty: 5, price: 45, stockOk: true },
    ],
    tracking: [], fees: [],
    logs: [{ time: '2026-07-07 10:00', action: '货盘分销订单创建', user: 'Sarah van Wyk' }],
  },
  {
    id: '11', customerId: '5', orderNo: 'ORD-JHB-260707002', platform: 'Takealot', store: '主店', country: '南非', countryCode: 'ZA',
    skuCount: 1, warehouse: 'jhb1', logistics: '快递', status: 'processing', exception: null,
    amount: 890, createdAt: '2026-07-07 11:30', recipient: 'Mike Botha',
    address: '12 Rivonia Rd, Sandton 2196, ZA',
    items: [{ sku: 'SKU-JNB-10021', name: '无线蓝牙耳机 Pro', qty: 2, price: 445, stockOk: true }],
    tracking: [],
    fees: [],
    logs: [{ time: '2026-07-07 11:30', action: '混合客户订单同步', user: '系统' }],
  },
  {
    id: '12', customerId: '4', orderNo: 'ORD-PAL-260706003', platform: 'Manual', store: '—', country: '南非', countryCode: 'ZA',
    skuCount: 1, warehouse: 'jhb1', logistics: '—', status: 'pending_review', exception: null,
    amount: 280, createdAt: '2026-07-06 15:00', recipient: 'Lisa Pretorius',
    address: 'Johannesburg 2000, ZA',
    items: [{ sku: 'HX6', name: '6双袜', qty: 8, price: 35, stockOk: true }],
    tracking: [], fees: [],
    logs: [{ time: '2026-07-06 15:00', action: '货盘出库预约', user: 'Lisa Pretorius' }],
  },
]

export const inventory: InventoryItem[] = [
  { id: '1', sku: 'SKU-JNB-10021', name: '无线蓝牙耳机 Pro', image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=80&h=80&fit=crop', available: 1240, locked: 80, inTransit: 0, safetyStock: 200, spec: '黑色 / 标准版', customCode: 'BT-PRO-BK', ean: '6901234567890', warehouse: 'jhb1', pendingShelving: 0, pendingOutbound: 45, defective: 2, shipped: 320, warningQty: 200, price: 289, declaredNameEn: 'Bluetooth Earbuds', categoryPath: '数码&电子 > 音频设备 > 蓝牙耳机', stockSource: 'owned' },
  { id: '2', sku: 'SKU-JNB-10034', name: 'USB-C 快充数据线 2m', image: 'https://images.unsplash.com/photo-1583394838336-acd977736f90?w=80&h=80&fit=crop', available: 5600, locked: 200, inTransit: 120, safetyStock: 500, spec: '白色 / 65W', customCode: 'CABLE-2M-W', ean: '6901234567891', warehouse: 'jhb1', pendingShelving: 120, pendingOutbound: 80, defective: 0, shipped: 890, warningQty: 500, price: 45, declaredNameEn: 'USB-C Cable', categoryPath: '数码&电子 > 数据线 > USB-C', stockSource: 'catalog' },
  { id: '3', sku: 'SKU-JNB-10058', name: '手机支架 磁吸款', image: 'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=80&h=80&fit=crop', available: 89, locked: 0, inTransit: 150, safetyStock: 100, spec: '银色 / 车载', customCode: 'MOUNT-SV', ean: '6901234567892', warehouse: 'jhb1', pendingShelving: 150, pendingOutbound: 12, defective: 1, shipped: 56, warningQty: 100, price: 78, declaredNameEn: 'Magnetic Phone Mount', categoryPath: '汽车&摩托 > 车载配件 > 手机支架', stockSource: 'catalog' },
  { id: '4', sku: 'SKU-JNB-10072', name: '便携榨汁杯 380ml', image: 'https://images.unsplash.com/photo-1585515320310-259814833e62?w=80&h=80&fit=crop', available: 0, locked: 50, inTransit: 200, safetyStock: 50, spec: '粉色 / 充电款', customCode: 'JUICER-PK', ean: '6901234567893', warehouse: 'jhb1', pendingShelving: 200, pendingOutbound: 0, defective: 3, shipped: 42, warningQty: 50, price: 156, declaredNameEn: 'Portable Juicer Cup', categoryPath: '家居&厨房 > 小家电 > 榨汁杯', stockSource: 'owned' },
  { id: '5', sku: 'SKU-JNB-10089', name: 'LED 化妆镜 带灯', image: 'https://images.unsplash.com/photo-1522338242992-e1a54906a8da?w=80&h=80&fit=crop', available: 310, locked: 20, inTransit: 0, safetyStock: 100, spec: '玫瑰金 / 10x', customCode: 'MIRROR-RG', ean: '6901234567894', warehouse: 'jhb1', pendingShelving: 0, pendingOutbound: 18, defective: 0, shipped: 128, warningQty: 100, price: 198, declaredNameEn: 'LED Makeup Mirror', categoryPath: '美妆&个护 > 化妆工具 > 化妆镜', stockSource: 'owned' },
  { id: '6', sku: 'SKU-JNB-10105', name: '运动水杯 750ml', image: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=80&h=80&fit=crop', available: 2100, locked: 0, inTransit: 0, safetyStock: 300, spec: '蓝色 / Tritan', customCode: 'BOTTLE-BL', ean: '6901234567895', warehouse: 'jhb1', pendingShelving: 0, pendingOutbound: 25, defective: 0, shipped: 410, warningQty: 300, price: 68, declaredNameEn: 'Sports Water Bottle', categoryPath: '运动&户外 > 水杯 > 运动水壶', stockSource: 'catalog' },
  { id: '7', customerId: '2', sku: 'HX6', name: '6双袜', image: 'https://images.unsplash.com/photo-1586350977777-b7613314aeee?w=80&h=80&fit=crop', available: 3200, locked: 0, inTransit: 0, safetyStock: 500, spec: '混色 / 均码', ean: '9902368930351', warehouse: 'jhb1', pendingShelving: 0, pendingOutbound: 0, defective: 0, shipped: 1200, warningQty: 500, price: 35, declaredNameEn: 'Socks', categoryPath: '服饰&鞋包 > 袜子 > 运动袜', stockSource: 'catalog' },
  { id: '8', customerId: '5', sku: 'SKU-JNB-10021', name: '无线蓝牙耳机 Pro', image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=80&h=80&fit=crop', available: 420, locked: 30, inTransit: 0, safetyStock: 100, spec: '黑色', customCode: 'BT-DUAL', ean: '6901234567890', warehouse: 'jhb1', pendingShelving: 0, pendingOutbound: 12, defective: 0, shipped: 88, warningQty: 100, price: 289, declaredNameEn: 'Bluetooth Earbuds', categoryPath: '数码&电子 > 音频设备', stockSource: 'owned' },
]

export const feeRecords: FeeRecord[] = [
  { id: '1', date: '2026-07-06', type: 'shipping', refNo: 'OUT-260706001', desc: 'DHL 南非国内', amount: -45 },
  { id: '2', date: '2026-07-05', type: 'storage', refNo: '—', desc: '按体积计费 0.32m³', amount: -128 },
  { id: '3', date: '2026-07-04', type: 'handling', refNo: 'IN-260705002', desc: '入库操作', amount: -35 },
  {
    id: '4', date: '2026-07-01 14:32:18', type: 'recharge', refNo: 'RCH-20260701001',
    desc: '银行转账充值', amount: 10000, customerCode: 'SA-2024-0086', rechargeNo: 'RCH-20260701001',
    paymentMethodId: 'pm-bank', paymentMethodTitle: '对公转账',
  },
  {
    id: '6', date: '2026-06-15 09:48:05', type: 'recharge', refNo: 'RCH-20260615002',
    desc: '支付宝充值', amount: 20000, customerCode: 'SA-2024-0086', rechargeNo: 'RCH-20260615002',
    paymentMethodId: 'pm-alipay', paymentMethodTitle: '支付宝',
  },
  { id: '5', date: '2026-06-28', type: 'shipping', refNo: 'OUT-260628015', desc: 'FedEx 国际', amount: -280 },
]

export const dashboardStats = {
  today: { newOrders: 47, shipped: 32, pending: 12, exceptions: 3, gmv: 18200 },
  funnel: { pending_payment: 5, pending_review: 3, pending_ship: 8, shipped_out: 24, delivered: 18 },
  exceptions: [
    { type: 'address_error' as ExceptionType, label: '地址异常', count: 2 },
    { type: 'stock_short' as ExceptionType, label: '库存不足', count: 1 },
    { type: 'logistics_fail' as ExceptionType, label: '物流失败', count: 1 },
    { type: 'sync_fail' as ExceptionType, label: '订单同步失败', count: 0 },
  ],
  logistics: { avgDeliveryDays: 4.2, exceptionRate: 2.1, topCountries: [{ code: 'ZA', pct: 82 }, { code: 'US', pct: 12 }] },
}

/** Buffalo WMS 欢迎页待办统计 */
export const welcomePending = {
  inboundOnWay: 4,
  outboundPending: 3,
  orderPendingShip: 8,
  inventoryAlerts: 3,
  unreadMessages: 2,
}

export const announcements = [
  { id: '1', title: 'jhb1 仓库 7 月收货时间调整', date: '2026-07-05', type: 'notice' as const },
  { id: '2', title: 'Takealot 入仓标签规范更新', date: '2026-07-01', type: 'important' as const },
  { id: '3', title: '系统维护通知：7月10日 02:00-04:00', date: '2026-06-28', type: 'system' as const },
]

export interface SystemMessage {
  id: string
  title: string
  content: string
  type: 'inbound' | 'outbound' | 'billing' | 'system'
  read: boolean
  createdAt: string
}

export const systemMessages: SystemMessage[] = [
  { id: '1', title: '入库单 IN-20260706003 已提交', content: '您的预约入库单已提交，请打印箱唛并安排发货。', type: 'inbound', read: false, createdAt: '2026-07-06 14:20' },
  { id: '2', title: '出库单 OUT-20260706001 已回传物流单号', content: 'SF7829103456 已回传，可在订单与出库中查看轨迹。', type: 'outbound', read: false, createdAt: '2026-07-06 11:05' },
  { id: '3', title: '7月仓储账单已出账', content: '待支付金额 ¥3,280.00，请在费用管理中查看明细。', type: 'billing', read: true, createdAt: '2026-07-05 09:00' },
  { id: '4', title: '系统：Takealot API 授权即将过期', content: '副店 API 授权将于 7 月 15 日过期，请及时续期。', type: 'system', read: true, createdAt: '2026-07-04 16:30' },
]

export type PodStatus = 'pending' | 'uploaded' | 'not_required'

export interface LogisticsRecord {
  id: string
  refNo: string
  outboundNo: string
  carrier: string
  trackingNo: string
  status: 'in_transit' | 'delivered' | 'exception'
  destination: string
  updatedAt: string
  /** 送达平台仓后的签收单回传 */
  podStatus: PodStatus
  /** 海外仓扫码 POD 码（ERP 送达回传） */
  podCode?: string | null
  podFileName?: string
  /** data URL 或可访问地址 */
  podFileUrl?: string
  podUploadedAt?: string
  exceptionCode?: string
  exceptionReason?: string
}

export const POD_STATUS_LABELS: Record<PodStatus, string> = {
  pending: '待回传',
  uploaded: '已回传',
  not_required: '—',
}

export const logisticsRecords: LogisticsRecord[] = [
  { id: '1', refNo: 'ORD-260706001', outboundNo: 'OUT-20260706001', carrier: '卡派', trackingNo: 'SF7829103456', status: 'in_transit', destination: 'Takealot CPT 仓', updatedAt: '2026-07-07 10:30', podStatus: 'pending' },
  { id: '2', refNo: 'ORD-260705012', outboundNo: 'OUT-20260705002', carrier: '快递', trackingNo: 'DHL-ZA-8829103', status: 'delivered', destination: 'Takealot JHB 仓', updatedAt: '2026-07-06 18:45', podStatus: 'uploaded', podFileName: 'POD-OUT-20260705002.pdf', podUploadedAt: '2026-07-06 20:10' },
  { id: '3', refNo: 'CAT-SEL-20260705', outboundNo: 'OUT-20260705003', carrier: '—', trackingNo: '—', status: 'exception', destination: 'Takealot JNB 仓', updatedAt: '2026-07-05 09:12', podStatus: 'pending' },
]

export interface QcReport {
  id: string
  inboundNo: string
  sku: string
  productName: string
  sampleQty: number
  passQty: number
  failQty: number
  result: 'pass' | 'partial' | 'fail'
  reportDate: string
}

export const qcReports: QcReport[] = [
  { id: '1', inboundNo: 'IN-20260706001', sku: 'SKU-JNB-10021', productName: '无线蓝牙耳机 Pro', sampleQty: 50, passQty: 50, failQty: 0, result: 'pass', reportDate: '2026-07-04' },
  { id: '2', inboundNo: 'IN-20260705004', sku: 'SKU-JNB-10058', productName: '手机支架 磁吸款', sampleQty: 60, passQty: 55, failQty: 5, result: 'partial', reportDate: '2026-07-03' },
]

export const reportSummary = {
  orderTrend: [{ month: '3月', orders: 820, gmv: 285000 }, { month: '4月', orders: 910, gmv: 312000 }, { month: '5月', orders: 1050, gmv: 358000 }, { month: '6月', orders: 1180, gmv: 402000 }],
  inventoryTurnover: 28,
  fulfillmentRate: 97.2,
  feeBreakdown: [{ type: '仓储费', pct: 42 }, { type: '操作费', pct: 28 }, { type: '物流费', pct: 30 }],
}

export const statusLabels: Record<string, string> = {
  pending_payment: '待付款', pending_review: '待审核', pending_ship: '待发货',
  processing: '仓库处理中', shipped_out: '已出库', in_transit: '运输中',
  delivered: '已签收', exception: '异常', cancelled: '已取消',
  stock_short: '库存不足', address_error: '地址异常',
  logistics_fail: '物流失败', sync_fail: '同步失败',
  low: '低库存', out: '断货', normal: '正常',
  storage: '仓储费', handling: '操作费', shipping: '物流费', recharge: '充值',
}

export const statusColors: Record<string, string> = {
  pending_payment: 'bg-slate-100 text-slate-700',
  pending_review: 'bg-amber-100 text-amber-800',
  pending_ship: 'bg-sky-100 text-sky-800',
  processing: 'bg-violet-100 text-violet-800',
  shipped_out: 'bg-cyan-100 text-cyan-800',
  in_transit: 'bg-cyan-100 text-cyan-800',
  delivered: 'bg-emerald-100 text-emerald-800',
  exception: 'bg-red-100 text-red-800',
  stock_short: 'bg-red-100 text-red-800',
  address_error: 'bg-orange-100 text-orange-800',
  logistics_fail: 'bg-amber-100 text-amber-800',
  sync_fail: 'bg-purple-100 text-purple-800',
  low: 'bg-amber-100 text-amber-800',
  out: 'bg-red-100 text-red-800',
  normal: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-amber-100 text-amber-800',
  locked: 'bg-sky-100 text-sky-800',
  picking: 'bg-violet-100 text-violet-800',
  shipped: 'bg-cyan-100 text-cyan-800',
  draft: 'bg-slate-100 text-slate-600',
  receiving: 'bg-violet-100 text-violet-800',
  partial: 'bg-amber-100 text-amber-800',
  completed: 'bg-emerald-100 text-emerald-800',
  deprecated: 'bg-slate-100 text-slate-600',
  unpaid: 'bg-amber-100 text-amber-800',
  paid: 'bg-emerald-100 text-emerald-800',
  overdue: 'bg-red-100 text-red-800',
  inspecting: 'bg-violet-100 text-violet-800',
  received: 'bg-sky-100 text-sky-800',
  active: 'bg-emerald-100 text-emerald-800',
}

export const exceptionBorderColors: Record<string, string> = {
  stock_short: 'border-l-red-500',
  address_error: 'border-l-orange-500',
  logistics_fail: 'border-l-amber-500',
  sync_fail: 'border-l-purple-500',
}

export const CURRENCY_CODE = 'CNY'
export const CURRENCY_LABEL = '人民币'

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: CURRENCY_CODE,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount))
}

export function getInventoryStatus(item: InventoryItem): 'normal' | 'low' | 'out' {
  if (item.available === 0 && item.inTransit === 0) return 'out'
  if (item.available < item.safetyStock) return 'low'
  return 'normal'
}

export function countOrdersByTab(tab: string, orderList: Order[] = orders): number {
  if (tab === 'all') return orderList.length
  if (tab === 'pending_calc') return orderList.filter(o => ['pending_payment', 'pending_review'].includes(o.status)).length
  if (tab === 'paused') return orderList.filter(o => o.status === 'pending_payment').length
  if (tab === 'pending_review') return orderList.filter(o => o.status === 'pending_review').length
  if (tab === 'pending_ship') return orderList.filter(o => o.status === 'pending_ship').length
  if (tab === 'picking') return orderList.filter(o => o.status === 'processing').length
  if (tab === 'shipping') return orderList.filter(o => ['processing', 'shipped_out', 'in_transit'].includes(o.status)).length
  if (tab === 'shipped') return orderList.filter(o => o.status === 'delivered').length
  if (tab === 'problem') return orderList.filter(o => o.exception !== null || o.status === 'exception').length
  if (tab === 'exception') return orderList.filter(o => o.exception !== null || o.status === 'exception').length
  if (tab === 'cancelled') return orderList.filter(o => o.status === 'cancelled').length
  return 0
}

// ─── 原项目：商品 / 入库 / 发货出库 / 编码 ─────────────────────────

export type LegacyOrderStatus = 'draft' | 'pending' | 'locked' | 'picking' | 'shipped' | 'delivered' | 'exception'
export type InboundStatus = 'draft' | 'receiving' | 'partial' | 'completed' | 'exception' | 'on_the_way' | 'shelved'
export type OutboundType = 'dropship' | 'takealot'
export type CodeStatus = 'active' | 'pending_review' | 'deprecated'
/** 发货来源：平台订单驱动 / 货盘分销 / 手工创建 */
export type ShipmentSource = 'platform_order' | 'catalog_dist' | 'manual'
/** 库存来源：客户自有 vs 货盘选品 */
export type StockSource = 'owned' | 'catalog'

export const SHIPMENT_SOURCE_LABELS: Record<ShipmentSource, string> = {
  platform_order: '平台订单',
  catalog_dist: '货盘分销',
  manual: '手工录入',
}

export const STOCK_SOURCE_LABELS: Record<StockSource, string> = {
  owned: '自有库存',
  catalog: '货盘库存',
}

/** 发货来源默认匹配的库存池（混合客户手工录入需手动选择） */
export function stockSourceForShipment(source: ShipmentSource): StockSource | null {
  if (source === 'platform_order') return 'owned'
  if (source === 'catalog_dist') return 'catalog'
  return null
}

export const FULFILLMENT_FLOW_STEPS = [
  '创建出库单', '选择发货仓库', '匹配库存来源', '锁定库存',
  '预约发货', '仓库出库', '回传反馈', '费用结算', '报表输出',
] as const

export type ProductStatus = 'available' | 'draft' | 'discarded' | 'reviewing'
export type ProductSource = 'manual' | 'import'

export interface Product {
  id: string
  customerId?: string
  internalSku: string
  /** 客户填写的 SKU（OMS 展示用，可重复） */
  customerSku?: string
  name: string
  spec: string
  image: string
  price: number
  cost: number
  availableQty: number
  lockedQty: number
  customCode?: string
  category: string
  categoryPath: string
  weight: string
  weightKg: number
  lengthCm: number
  widthCm: number
  heightCm: number
  inCatalog: boolean
  catalogStockPool?: number
  catalogSoldQty?: number
  catalogVisibleOnOms?: boolean
  catalogOrderableOnOms?: boolean
  catalogSyncedAt?: string
  productStatus: ProductStatus
  /** 手动创建或模板导入，决定保存并审核是否自动通过 */
  productSource?: ProductSource
  hasBattery: boolean
  certUploaded: boolean
  hasBoxSpec: boolean
  outerBoxBarcode?: string
  declaredNameEn: string
  declaredNameCn: string
  declaredValue: number
  unit: string
}

export interface ProductLogEntry {
  id: string
  productId: string
  action: string
  operator: string
  createdAt: string
  ip: string
}

export function getProductLogs(productId: string, productList: Product[] = products): ProductLogEntry[] {
  const product = productList.find(p => p.id === productId)
  if (!product) return []
  const logs: ProductLogEntry[] = [
    {
      id: `${productId}-create`,
      productId,
      action: '新建产品',
      operator: 'HX',
      createdAt: '2026-06-25 14:09:16',
      ip: '192.168.1.100',
    },
  ]
  if (product.productStatus === 'reviewing') {
    logs.unshift({
      id: `${productId}-review`,
      productId,
      action: '提交审核',
      operator: 'HX',
      createdAt: '2026-06-26 09:12:04',
      ip: '192.168.1.100',
    })
  }
  if (product.certUploaded) {
    logs.unshift({
      id: `${productId}-cert`,
      productId,
      action: '上传证书',
      operator: 'HX',
      createdAt: '2026-06-27 11:30:22',
      ip: '192.168.1.100',
    })
  }
  return logs
}

export type InboundType = '自发头程' | '中转入库' | '退货入库' | '货盘入库'
export type DeliveryMethod = 'self' | 'pickup'

export const INBOUND_TYPE_LABELS: Record<InboundType, string> = {
  '自发头程': '自发头程',
  '中转入库': '中转入库',
  '退货入库': '退货入库',
  '货盘入库': '货盘入库',
}

export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
  self: '自送',
  pickup: '揽收',
}

export interface InboundOrder {
  id: string
  customerId?: string
  inboundNo: string
  source: string
  inboundType: InboundType
  deliveryMethod: DeliveryMethod
  stockSource: StockSource
  boxCount: number
  skuCount: number
  totalQty: number
  receivedQty: number
  status: InboundStatus
  createdAt: string
  eta?: string
  warehouse: string
  referenceNo?: string
  trackingNo?: string
  contact?: string
  contactPhone?: string
  skuHint?: string
  remark?: string
  exceptionCode?: string
  exceptionReason?: string
  lineItems?: InboundLineItem[]
  attachments?: FileAttachment[]
}

export interface OutboundRecipient {
  name: string
  province?: string
  city: string
  postalCode: string
  phone: string
  address1: string
  address2?: string
  email?: string
}

export interface OutboundOrder {
  id: string
  customerId?: string
  /** 系统自动生成的出库单号 */
  outboundNo: string
  source: ShipmentSource
  stockSource: StockSource
  /** 客户填写的参考号（对账/PO 等） */
  refNo?: string
  /** 关联的平台订单号（系统内部关联，非客户参考号） */
  orderNo?: string
  type: OutboundType
  warehouse: string
  items: number
  totalQty: number
  status: LegacyOrderStatus
  destination: string
  createdAt: string
  /** 海外仓回传的运单号，创建时不填 */
  trackingNo?: string
  shippingMethod?: LogisticsChannel | string
  recipient?: OutboundRecipient
  /** 提交时预扣费用明细 */
  preDeductFees?: { type: string; amount: number; label?: string; detail?: string }[]
  /** P6-1：预扣摘要（同步 ERP 后也可回读） */
  destRegion?: string
  priceTemplateId?: string
  priceTemplateName?: string
  preDeductTotal?: number
  preDeductVolumeM3?: number
  preDeductWeightKg?: number
  /** ERP 实测实算（P6-2） */
  actualFeesTotal?: number
  measuredVolumeM3?: number
  measuredWeightKg?: number
  measure?: {
    cartons: {
      cartonNo: number
      lengthCm: number
      widthCm: number
      heightCm: number
      grossWeightKg: number
      volumeCbm: number
    }[]
    totalVolumeM3: number
    totalWeightKg: number
    measuredAt: string
  }
  actualFees?: {
    lines: {
      type: string
      label: string
      amount: number
      detail?: string
      chargeType?: string
    }[]
    actualTotal: number
    calculatedAt: string
  }
  /** P6-3：预扣 vs 实扣对账 */
  settlementStatus?: 'pending' | 'settled' | 'refunded'
  settlementDelta?: number
  /** 预约送仓日期 YYYY-MM-DD */
  scheduledDeliveryDate?: string
  /** Takealot 店铺名称（Seller Name） */
  sellerStoreName?: string
  /** Takealot 目的仓代码 jhb3 / cpt2 / dbn */
  takealotDestWarehouse?: string
  takealotSellerId?: string
  takealotBookingRef?: string
  /** 发货清单 Due Date */
  shipmentDueDate?: string
  remark?: string
  exceptionCode?: string
  exceptionReason?: string
  /** 可选的客户端附件持久化引用；不依赖 Prisma 字段。 */
  attachmentStorageRef?: string
  takealotLabelValidation?: {
    expectedQty: number
    observedQty: number
    cropCount: number
    blockingCount: number
  }
  lineItems?: OutboundLineItem[]
  attachments?: FileAttachment[]
}

export interface CodeMapping {
  id: string
  internalSku: string
  productName: string
  codeType: 'custom' | 'box_label'
  codeValue: string
  status: CodeStatus
  version: number
  hasInventory: boolean
  updatedAt: string
  /** 平台条码类编码已迁移至 platformSkuMappings */
  platformMappingId?: string
}

export type PlatformBindingStatus = 'unmapped' | 'active' | 'pending_review' | 'barcode_mismatch' | 'deprecated'
export type PlatformSyncSource = 'api' | 'import' | 'manual'
export type StorePlatform = 'Takealot' | 'Shopify' | 'Manual'
export type StoreStatus = 'connected' | 'sync_fail' | 'disconnected' | 'disabled'

export interface PlatformBindingLine {
  internalSku: string
  warehouseName: string
  shortName?: string
  packType: string
  qty: number
}

export interface PlatformSkuMapping {
  id: string
  customerId?: string
  /** 平台 Seller ID；旧数据可由 storeId 关联 StoreAccount 获取。 */
  sellerId?: string
  platform: StorePlatform
  storeId: string
  storeName: string
  /** 可选；平台侧商品 ID（如历史 TSIN），绑定不以它为必填 */
  platformSkuId?: string
  platformBarcode: string
  platformTitle: string
  platformListingId?: string
  lines: PlatformBindingLine[]
  status: PlatformBindingStatus
  stockSource: StockSource
  syncSource: PlatformSyncSource
  version: number
  hasInventory: boolean
  lastSyncAt?: string
  updatedAt: string
}

export const PLATFORM_BINDING_STATUS_LABELS: Record<PlatformBindingStatus, string> = {
  unmapped: '待绑定',
  active: '已绑定',
  pending_review: '待审核',
  barcode_mismatch: '条码不一致',
  deprecated: '已停用',
}

export interface StoreAccount {
  id: string
  customerId?: string
  platform: StorePlatform
  name: string
  storeCode: string
  sellerId: string
  status: StoreStatus
  orderSync: boolean
  inventorySync: boolean
  autoPullInterval: string
  lastSyncAt: string
  todayOrders: number
  syncError?: string
  apiKeyMasked: string
  webhookUrl: string
  createdAt: string
}

export const stores: StoreAccount[] = [
  {
    id: '1', customerId: '1', platform: 'Takealot', name: '主店', storeCode: 'TL-MAIN-001', sellerId: 'SA-TRADE-886',
    status: 'connected', orderSync: true, inventorySync: true, autoPullInterval: '每 15 分钟',
    lastSyncAt: '2026-07-07 15:32', todayOrders: 28, apiKeyMasked: 'tk_live_••••••••8f2a',
    webhookUrl: 'https://oms.example.com/hook/takealot/main', createdAt: '2025-11-12',
  },
  {
    id: '2', customerId: '1', platform: 'Takealot', name: '副店', storeCode: 'TL-SUB-002', sellerId: 'SA-TRADE-887',
    status: 'sync_fail', orderSync: true, inventorySync: false, autoPullInterval: '每 30 分钟',
    lastSyncAt: '2026-07-07 14:05', todayOrders: 6, syncError: 'API 授权过期，请重新授权',
    apiKeyMasked: 'tk_live_••••••••3b91', webhookUrl: 'https://oms.example.com/hook/takealot/sub', createdAt: '2026-02-20',
  },
  {
    id: '3', customerId: '1', platform: 'Shopify', name: '独立站', storeCode: 'SF-STORE-01', sellerId: 'shop-sa-trade',
    status: 'connected', orderSync: true, inventorySync: true, autoPullInterval: '每 10 分钟',
    lastSyncAt: '2026-07-07 15:30', todayOrders: 12, apiKeyMasked: 'shpat_••••••••c4e7',
    webhookUrl: 'https://oms.example.com/hook/shopify/store01', createdAt: '2026-04-08',
  },
  {
    id: '4', customerId: '5', platform: 'Manual', name: '线下渠道', storeCode: 'MANUAL-01', sellerId: '—',
    status: 'connected', orderSync: false, inventorySync: false, autoPullInterval: '—',
    lastSyncAt: '—', todayOrders: 3, apiKeyMasked: '—',
    webhookUrl: '—', createdAt: '2026-01-05',
  },
  {
    id: '5', customerId: '1', platform: 'Takealot', name: '测试店', storeCode: 'TL-TEST-99', sellerId: 'SA-TEST-001',
    status: 'disabled', orderSync: false, inventorySync: false, autoPullInterval: '—',
    lastSyncAt: '2026-06-01 09:00', todayOrders: 0, apiKeyMasked: 'tk_test_••••••••1a00',
    webhookUrl: '—', createdAt: '2026-05-15',
  },
]

export const products: Product[] = [
  {
    id: '1', internalSku: 'SKU-JNB-10021', name: '无线蓝牙耳机 Pro', spec: '黑色 / 标准版',
    image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=120&h=120&fit=crop',
    price: 289, cost: 168, availableQty: 1240, lockedQty: 80, customCode: 'BT-PRO-BK',
    category: '数码配件', categoryPath: '数码&电子 > 音频设备 > 蓝牙耳机', weight: '0.32kg', weightKg: 0.32,
    lengthCm: 18, widthCm: 12, heightCm: 6, inCatalog: true, productStatus: 'available',
    hasBattery: true, certUploaded: true, hasBoxSpec: true, outerBoxBarcode: 'OBX-88291001',
    declaredNameEn: 'Bluetooth Earbuds', declaredNameCn: '无线蓝牙耳机', declaredValue: 12.5, unit: 'PCS',
  },
  {
    id: '2', internalSku: 'SKU-JNB-10034', name: 'USB-C 快充数据线 2m', spec: '白色 / 65W',
    image: 'https://images.unsplash.com/photo-1583394838336-acd977736f90?w=120&h=120&fit=crop',
    price: 45, cost: 18, availableQty: 5600, lockedQty: 200, customCode: 'CABLE-2M-W',
    category: '数码配件', categoryPath: '数码&电子 > 数据线 > USB-C', weight: '0.08kg', weightKg: 0.08,
    lengthCm: 12, widthCm: 8, heightCm: 2, inCatalog: true, productStatus: 'available',
    hasBattery: false, certUploaded: false, hasBoxSpec: true, outerBoxBarcode: 'OBX-88291002',
    declaredNameEn: 'USB-C Cable', declaredNameCn: 'USB-C数据线', declaredValue: 2.8, unit: 'PCS',
  },
  {
    id: '3', internalSku: 'SKU-JNB-10058', name: '手机支架 磁吸款', spec: '银色 / 车载',
    image: 'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=120&h=120&fit=crop',
    price: 78, cost: 32, availableQty: 89, lockedQty: 0,
    category: '车载用品', categoryPath: '汽车&摩托 > 车载配件 > 手机支架', weight: '0.15kg', weightKg: 0.15,
    lengthCm: 10, widthCm: 10, heightCm: 5, inCatalog: true, productStatus: 'available',
    hasBattery: false, certUploaded: false, hasBoxSpec: false,
    declaredNameEn: 'Magnetic Phone Mount', declaredNameCn: '磁吸手机支架', declaredValue: 4.5, unit: 'PCS',
  },
  {
    id: '4', internalSku: 'SKU-JNB-10072', name: '便携榨汁杯 380ml', spec: '粉色 / 充电款',
    image: 'https://images.unsplash.com/photo-1585515320310-259814833e62?w=120&h=120&fit=crop',
    price: 156, cost: 72, availableQty: 420, lockedQty: 50, customCode: 'JUICER-PK',
    category: '厨房小电', categoryPath: '家居&厨房 > 小家电 > 榨汁杯', weight: '0.65kg', weightKg: 0.65,
    lengthCm: 22, widthCm: 9, heightCm: 9, inCatalog: true, productStatus: 'reviewing',
    hasBattery: true, certUploaded: false, hasBoxSpec: true,
    declaredNameEn: 'Portable Juicer Cup', declaredNameCn: '便携榨汁杯', declaredValue: 18.0, unit: 'PCS',
  },
  {
    id: '5', internalSku: 'SKU-JNB-10089', name: 'LED 化妆镜 带灯', spec: '玫瑰金 / 10x',
    image: 'https://images.unsplash.com/photo-1522338242992-e1a54906a8da?w=120&h=120&fit=crop',
    price: 198, cost: 95, availableQty: 310, lockedQty: 20, customCode: 'MIRROR-RG',
    category: '美妆工具', categoryPath: '美妆&个护 > 化妆工具 > 化妆镜', weight: '0.48kg', weightKg: 0.48,
    lengthCm: 25, widthCm: 18, heightCm: 4, inCatalog: false, productStatus: 'draft',
    hasBattery: false, certUploaded: false, hasBoxSpec: false,
    declaredNameEn: 'LED Makeup Mirror', declaredNameCn: 'LED化妆镜', declaredValue: 15.0, unit: 'PCS',
  },
  {
    id: '6', internalSku: 'SKU-JNB-10105', name: '运动水杯 750ml', spec: '蓝色 / Tritan',
    image: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=120&h=120&fit=crop',
    price: 68, cost: 28, availableQty: 2100, lockedQty: 0,
    category: '运动户外', categoryPath: '运动&户外 > 水杯 > 运动水壶', weight: '0.22kg', weightKg: 0.22,
    lengthCm: 24, widthCm: 8, heightCm: 8, inCatalog: true, productStatus: 'available',
    hasBattery: false, certUploaded: true, hasBoxSpec: true, outerBoxBarcode: 'OBX-88291006',
    declaredNameEn: 'Sports Water Bottle', declaredNameCn: '运动水杯', declaredValue: 5.5, unit: 'PCS',
  },
  {
    id: '7', internalSku: 'HX6', name: '6双袜', spec: '混色 / 均码',
    image: 'https://images.unsplash.com/photo-1586350977777-b7613314aeee?w=120&h=120&fit=crop',
    price: 35, cost: 12, availableQty: 3200, lockedQty: 0,
    category: '服饰', categoryPath: '服饰&鞋包 > 袜子 > 运动袜', weight: '0.12kg', weightKg: 0.12,
    lengthCm: 1, widthCm: 1, heightCm: 1, inCatalog: true, productStatus: 'available',
    hasBattery: false, certUploaded: false, hasBoxSpec: true,
    declaredNameEn: 'Socks', declaredNameCn: '袜子', declaredValue: 1.0, unit: 'SET',
  },
  {
    id: '8', internalSku: 'SKU-JNB-10120', name: 'Terry socks 毛巾袜', spec: '白色 / 均码',
    image: 'https://images.unsplash.com/photo-1586350977777-b7613314aeee?w=120&h=120&fit=crop',
    price: 28, cost: 10, availableQty: 0, lockedQty: 0,
    category: '服饰', categoryPath: '服饰&鞋包 > 袜子 > 棉袜', weight: '0.10kg', weightKg: 0.10,
    lengthCm: 1, widthCm: 1, heightCm: 1, inCatalog: true, productStatus: 'discarded',
    hasBattery: false, certUploaded: false, hasBoxSpec: false,
    declaredNameEn: 'Terry Socks', declaredNameCn: '毛巾袜', declaredValue: 0.8, unit: 'PCS',
  },
  {
    id: '9', customerId: '2', internalSku: 'CPT-CABLE-01', name: '货盘专供数据线 3m', spec: '黑色 / 100W',
    image: 'https://images.unsplash.com/photo-1583394838336-acd977736f90?w=120&h=120&fit=crop',
    price: 38, cost: 15, availableQty: 8800, lockedQty: 0,
    category: '数码配件', categoryPath: '数码&电子 > 数据线', weight: '0.1kg', weightKg: 0.1,
    lengthCm: 15, widthCm: 8, heightCm: 2, inCatalog: true, productStatus: 'available',
    hasBattery: false, certUploaded: false, hasBoxSpec: true,
    declaredNameEn: 'USB Cable 3m', declaredNameCn: '数据线', declaredValue: 2.0, unit: 'PCS',
  },
  {
    id: '10', customerId: '4', internalSku: 'PAL-SOCK-12', name: '货盘批发袜 12双装', spec: '混色',
    image: 'https://images.unsplash.com/photo-1586350977777-b7613314aeee?w=120&h=120&fit=crop',
    price: 58, cost: 22, availableQty: 1500, lockedQty: 100,
    category: '服饰', categoryPath: '服饰&鞋包 > 袜子', weight: '0.2kg', weightKg: 0.2,
    lengthCm: 1, widthCm: 1, heightCm: 1, inCatalog: true, productStatus: 'available',
    hasBattery: false, certUploaded: false, hasBoxSpec: false,
    declaredNameEn: 'Socks 12pk', declaredNameCn: '袜子12双', declaredValue: 1.5, unit: 'SET',
  },
]

export const inboundOrders: InboundOrder[] = [
  { id: '1', inboundNo: 'IN-20260706001', source: 'ERP出库同步', inboundType: '自发头程', deliveryMethod: 'self', stockSource: 'owned', boxCount: 12, skuCount: 3, totalQty: 480, receivedQty: 480, status: 'shelved', createdAt: '2026-07-04', eta: '2026-07-03', warehouse: 'jhb1', referenceNo: 'REF-ERP-8801', trackingNo: 'SF7829103400', contact: 'David Nkosi', contactPhone: '+27 82 123 4567', skuHint: 'SKU-JNB-10021' },
  { id: '2', inboundNo: 'IN-20260706002', source: '客户创建', inboundType: '自发头程', deliveryMethod: 'pickup', stockSource: 'owned', boxCount: 8, skuCount: 2, totalQty: 320, receivedQty: 200, status: 'partial', createdAt: '2026-07-05', eta: '2026-07-06', warehouse: 'jhb1', referenceNo: 'REF-CUS-2205', contact: 'David Nkosi', contactPhone: '+27 82 123 4567', skuHint: 'SKU-JNB-10034' },
  { id: '3', inboundNo: 'IN-20260706003', source: '客户创建', inboundType: '自发头程', deliveryMethod: 'self', stockSource: 'owned', boxCount: 5, skuCount: 1, totalQty: 150, receivedQty: 0, status: 'on_the_way', createdAt: '2026-07-06', eta: '2026-07-10', warehouse: 'jhb1', referenceNo: 'REF-CUS-2206', trackingNo: 'DHL-ZA-99102', contact: 'David Nkosi', contactPhone: '+27 82 123 4567', skuHint: 'SKU-JNB-10072' },
  { id: '4', inboundNo: 'IN-20260705004', source: 'ERP出库同步', inboundType: '中转入库', deliveryMethod: 'self', stockSource: 'catalog', boxCount: 3, skuCount: 1, totalQty: 60, receivedQty: 55, status: 'exception', createdAt: '2026-07-03', eta: '2026-07-04', warehouse: 'jhb1', referenceNo: 'REF-ERP-8799', skuHint: 'SKU-JNB-10058' },
  { id: '5', inboundNo: 'IN-20260707001', source: '客户创建', inboundType: '自发头程', deliveryMethod: 'self', stockSource: 'owned', boxCount: 2, skuCount: 1, totalQty: 80, receivedQty: 0, status: 'draft', createdAt: '2026-07-07', eta: '2026-07-12', warehouse: 'jhb1', referenceNo: 'REF-CUS-2207', skuHint: 'HX6' },
  { id: '6', inboundNo: 'IN-20260707002', source: 'ERP出库同步', inboundType: '货盘入库', deliveryMethod: 'pickup', stockSource: 'catalog', boxCount: 6, skuCount: 2, totalQty: 240, receivedQty: 0, status: 'on_the_way', createdAt: '2026-07-07', eta: '2026-07-09', warehouse: 'jhb1', referenceNo: 'REF-ERP-8810', trackingNo: 'ARAMEX-772920', skuHint: 'SKU-JNB-10105' },
  { id: '7', inboundNo: 'IN-20260706005', source: '客户创建', inboundType: '自发头程', deliveryMethod: 'self', stockSource: 'owned', boxCount: 4, skuCount: 1, totalQty: 120, receivedQty: 120, status: 'completed', createdAt: '2026-07-06', eta: '2026-07-06', warehouse: 'jhb1', referenceNo: 'REF-CUS-2204', trackingNo: 'SF7829103455', skuHint: 'SKU-JNB-10089' },
  { id: '8', customerId: '2', inboundNo: 'IN-CPT-260707001', source: '客户创建', inboundType: '货盘入库', deliveryMethod: 'pickup', stockSource: 'catalog', boxCount: 4, skuCount: 2, totalQty: 160, receivedQty: 0, status: 'on_the_way', createdAt: '2026-07-07', eta: '2026-07-11', warehouse: 'jhb1', referenceNo: 'REF-CPT-8801', skuHint: 'CPT-CABLE-01' },
  { id: '9', customerId: '5', inboundNo: 'IN-JHB-260707001', source: '客户创建', inboundType: '自发头程', deliveryMethod: 'self', stockSource: 'owned', boxCount: 3, skuCount: 1, totalQty: 90, receivedQty: 0, status: 'on_the_way', createdAt: '2026-07-07', eta: '2026-07-10', warehouse: 'jhb1', referenceNo: 'REF-JHB-9901', trackingNo: 'SF8829109999', skuHint: 'SKU-JNB-10021' },
]

export const outboundOrders: OutboundOrder[] = [
  { id: '1', customerId: '1', outboundNo: 'OUT-20260706001', orderNo: 'ORD-260706001', refNo: 'PO-TAL-8821', source: 'platform_order', stockSource: 'owned', type: 'takealot', warehouse: 'jhb1', items: 2, totalQty: 150, status: 'picking', destination: 'Takealot CPT 仓', createdAt: '2026-07-06', shippingMethod: '卡派' },
  { id: '2', customerId: '1', outboundNo: 'OUT-20260705002', orderNo: 'ORD-260705012', refNo: 'REF-CUS-0502', source: 'platform_order', stockSource: 'owned', type: 'dropship', warehouse: 'jhb1', items: 1, totalQty: 3, status: 'shipped', destination: 'Cape Town · 8001', createdAt: '2026-07-05', trackingNo: 'DHL-ZA-8829103', shippingMethod: '快递' },
  { id: '3', customerId: '2', outboundNo: 'OUT-20260705003', refNo: 'CAT-SEL-20260705', source: 'catalog_dist', stockSource: 'catalog', type: 'takealot', warehouse: 'jhb1', items: 3, totalQty: 280, status: 'locked', destination: 'Takealot JNB 仓', createdAt: '2026-07-05', shippingMethod: '卡派' },
  { id: '4', customerId: '2', outboundNo: 'OUT-20260704004', refNo: 'CAT-SEL-20260704', source: 'catalog_dist', stockSource: 'catalog', type: 'dropship', warehouse: 'jhb1', items: 2, totalQty: 8, status: 'delivered', destination: 'Durban · 4001', createdAt: '2026-07-04', trackingNo: 'ARAMEX-772910', shippingMethod: '快递' },
  { id: '5', customerId: '1', outboundNo: 'OUT-20260703005', refNo: 'PO-MAN-0305', source: 'manual', stockSource: 'owned', type: 'takealot', warehouse: 'jhb1', items: 1, totalQty: 50, status: 'exception', destination: 'Takealot JNB 仓', createdAt: '2026-07-03', shippingMethod: '卡派' },
  { id: '6', customerId: '1', outboundNo: 'OUT-20260707001', orderNo: 'ORD-260704028', refNo: 'REF-SHOPIFY-0428', source: 'platform_order', stockSource: 'owned', type: 'dropship', warehouse: 'jhb1', items: 1, totalQty: 3, status: 'pending', destination: 'London · W1U 8EW', createdAt: '2026-07-07', shippingMethod: '快递' },
  { id: '7', customerId: '2', outboundNo: 'OUT-20260707002', refNo: 'CAT-SEL-20260707', source: 'catalog_dist', stockSource: 'catalog', type: 'dropship', warehouse: 'jhb1', items: 2, totalQty: 120, status: 'locked', destination: 'Pretoria · 0002', createdAt: '2026-07-07', shippingMethod: '快递' },
  { id: '8', customerId: '5', outboundNo: 'OUT-JHB-260707001', orderNo: 'ORD-JHB-260707002', refNo: 'PO-JHB-7702', source: 'platform_order', stockSource: 'owned', type: 'dropship', warehouse: 'jhb1', items: 1, totalQty: 2, status: 'locked', destination: 'Sandton · 2196', createdAt: '2026-07-07', shippingMethod: '快递' },
  { id: '9', customerId: '2', outboundNo: 'OUT-CPT-260707001', orderNo: 'ORD-CPT-260707001', refNo: 'REF-CPT-7001', source: 'catalog_dist', stockSource: 'catalog', type: 'dropship', warehouse: 'jhb1', items: 2, totalQty: 15, status: 'pending', destination: 'Cape Town · 8001', createdAt: '2026-07-07', shippingMethod: '卡派' },
  { id: '10', customerId: '1', outboundNo: 'OUT-20260706010', orderNo: 'ORD-260706002', source: 'platform_order', stockSource: 'owned', type: 'dropship', warehouse: 'jhb1', items: 2, totalQty: 3, status: 'pending', destination: 'Durban · 4001', createdAt: '2026-07-06', shippingMethod: '卡派' },
  { id: '11', customerId: '1', outboundNo: 'OUT-20260705011', orderNo: 'ORD-260705018', refNo: 'PO-US-0518', source: 'manual', stockSource: 'owned', type: 'dropship', warehouse: 'jhb1', items: 2, totalQty: 6, status: 'locked', destination: 'Los Angeles · 90001', createdAt: '2026-07-05', shippingMethod: '自提' },
]

export const codeMappings: CodeMapping[] = [
  { id: '2', internalSku: 'SKU-JNB-10021', productName: '无线蓝牙耳机 Pro', codeType: 'custom', codeValue: 'BT-PRO-BK', status: 'active', version: 1, hasInventory: true, updatedAt: '2026-05-20', platformMappingId: 'pb-1' },
  { id: '5', internalSku: 'SKU-JNB-10072', productName: '便携榨汁杯 380ml', codeType: 'custom', codeValue: 'JUICER-PK', status: 'active', version: 1, hasInventory: true, updatedAt: '2026-06-10' },
  { id: '6', internalSku: 'SKU-JNB-10021', productName: '无线蓝牙耳机 Pro', codeType: 'box_label', codeValue: 'OBX-88291001', status: 'active', version: 1, hasInventory: true, updatedAt: '2026-06-01' },
]

export const platformSkuMappings: PlatformSkuMapping[] = [
  {
    id: 'pb-1', platform: 'Takealot', storeId: '1', storeName: '主店',
    platformSkuId: '103882014', platformBarcode: '9901234567890',
    platformTitle: 'Wireless Bluetooth Earbuds Pro — Black',
    platformListingId: '0',
    lines: [{ internalSku: 'SKU-JNB-10021', warehouseName: '无线蓝牙耳机 Pro', shortName: '耳机Pro', packType: '自带包装', qty: 1 }],
    status: 'active', stockSource: 'owned', syncSource: 'manual', version: 2, hasInventory: true,
    lastSyncAt: '2026-07-07 15:32', updatedAt: '2026-06-15',
  },
  {
    id: 'pb-2', platform: 'Takealot', storeId: '1', storeName: '主店',
    platformSkuId: '104012889', platformBarcode: '9901234567891',
    platformTitle: 'USB-C Fast Charge Cable 2m White',
    lines: [{ internalSku: 'SKU-JNB-10034', warehouseName: 'USB-C 快充数据线 2m', packType: '自带包装', qty: 1 }],
    status: 'pending_review', stockSource: 'owned', syncSource: 'api', version: 3, hasInventory: true,
    lastSyncAt: '2026-07-07 15:32', updatedAt: '2026-07-05',
  },
  {
    id: 'pb-3', platform: 'Takealot', storeId: '1', storeName: '主店',
    platformSkuId: '104028776', platformBarcode: '9901234567892',
    platformTitle: 'Magnetic Phone Mount Car Silver',
    lines: [{ internalSku: 'SKU-JNB-10058', warehouseName: '手机支架 磁吸款', shortName: 'WM16', packType: '自带包装', qty: 1 }],
    status: 'active', stockSource: 'owned', syncSource: 'manual', version: 1, hasInventory: false,
    lastSyncAt: '2026-07-07 15:32', updatedAt: '2026-06-01',
  },
  {
    id: 'pb-4', platform: 'Takealot', storeId: '1', storeName: '主店',
    platformSkuId: '104038547', platformBarcode: '6009637108607',
    platformTitle: 'Indoor Jungle Gym, Foldable Climbing Frame Set',
    lines: [
      { internalSku: 'SKU-JNB-10058', warehouseName: '手机支架 磁吸款', shortName: 'WM16', packType: '自带包装', qty: 2 },
      { internalSku: 'SKU-JNB-10105', warehouseName: '运动水杯 750ml', shortName: 'WM24', packType: '自带包装', qty: 1 },
    ],
    status: 'active', stockSource: 'owned', syncSource: 'manual', version: 1, hasInventory: true,
    lastSyncAt: '2026-07-07 15:32', updatedAt: '2026-06-20',
  },
  {
    id: 'pb-5', platform: 'Takealot', storeId: '1', storeName: '主店',
    platformSkuId: '104044112', platformBarcode: '9901234567893',
    platformTitle: 'LED Makeup Mirror with Light Rose Gold',
    lines: [{ internalSku: 'SKU-JNB-10089', warehouseName: 'LED 化妆镜 带灯', packType: '自带包装', qty: 1 }],
    status: 'active', stockSource: 'owned', syncSource: 'import', version: 1, hasInventory: true,
    lastSyncAt: '2026-07-06 10:00', updatedAt: '2026-06-18',
  },
  {
    id: 'pb-6', platform: 'Takealot', storeId: '1', storeName: '主店',
    platformSkuId: '104051203', platformBarcode: '9901234567894',
    platformTitle: 'Sports Water Bottle 750ml Blue Tritan',
    lines: [{ internalSku: 'SKU-JNB-10105', warehouseName: '运动水杯 750ml', packType: '自带包装', qty: 1 }],
    status: 'active', stockSource: 'owned', syncSource: 'api', version: 1, hasInventory: true,
    lastSyncAt: '2026-07-07 15:32', updatedAt: '2026-06-22',
  },
  {
    id: 'pb-7', customerId: '2', platform: 'Takealot', storeId: '2', storeName: '副店',
    platformSkuId: '9902368930351', platformBarcode: '9902368930351',
    platformTitle: '6 Pack Sports Socks Mixed Colors',
    lines: [{ internalSku: 'HX6', warehouseName: '6双袜', shortName: '6双袜', packType: '自带包装', qty: 1 }],
    status: 'active', stockSource: 'catalog', syncSource: 'api', version: 1, hasInventory: true,
    lastSyncAt: '2026-07-07 14:05', updatedAt: '2026-07-01',
  },
  {
    id: 'pb-8', platform: 'Takealot', storeId: '2', storeName: '副店',
    platformSkuId: '104099221', platformBarcode: '6009637109421',
    platformTitle: 'LED Strip Light 5m RGB Smart WiFi',
    lines: [],
    status: 'unmapped', stockSource: 'owned', syncSource: 'api', version: 1, hasInventory: false,
    lastSyncAt: '2026-07-07 14:05', updatedAt: '2026-07-07 14:05',
  },
  {
    id: 'pb-9', platform: 'Takealot', storeId: '2', storeName: '副店',
    platformSkuId: '104101887', platformBarcode: '6009637109554',
    platformTitle: 'Portable Blender Cup 380ml Pink USB',
    lines: [],
    status: 'unmapped', stockSource: 'owned', syncSource: 'api', version: 1, hasInventory: false,
    lastSyncAt: '2026-07-07 14:05', updatedAt: '2026-07-07 14:05',
  },
  {
    id: 'pb-10', platform: 'Takealot', storeId: '1', storeName: '主店',
    platformSkuId: '104055001', platformBarcode: '6009637199999',
    platformTitle: 'Magnetic Phone Mount — listing barcode changed',
    lines: [{ internalSku: 'SKU-JNB-10058', warehouseName: '手机支架 磁吸款', packType: '自带包装', qty: 1 }],
    status: 'barcode_mismatch', stockSource: 'owned', syncSource: 'api', version: 2, hasInventory: false,
    lastSyncAt: '2026-07-07 15:32', updatedAt: '2026-07-06',
  },
  {
    id: 'pb-11', platform: 'Takealot', storeId: '1', storeName: '主店',
    platformSkuId: '9902368930352', platformBarcode: '9902368930352',
    platformTitle: 'Terry Socks White One Size',
    lines: [{ internalSku: 'SKU-JNB-10120', warehouseName: 'Terry socks 毛巾袜', packType: '自带包装', qty: 1 }],
    status: 'deprecated', stockSource: 'owned', syncSource: 'manual', version: 1, hasInventory: false,
    lastSyncAt: '2026-06-01 09:00', updatedAt: '2026-06-15',
  },
  {
    id: 'pb-12', platform: 'Shopify', storeId: '3', storeName: '独立站',
    platformSkuId: 'gid://shopify/Product/88291001', platformBarcode: '6901234567890',
    platformTitle: 'Bluetooth Earbuds Pro Black',
    lines: [{ internalSku: 'SKU-JNB-10021', warehouseName: '无线蓝牙耳机 Pro', packType: '自带包装', qty: 1 }],
    status: 'active', stockSource: 'owned', syncSource: 'api', version: 1, hasInventory: true,
    lastSyncAt: '2026-07-07 15:30', updatedAt: '2026-04-10',
  },
]

export type FulfillmentWarehouseId = 'jhb1' | 'jhb3' | 'cpt1' | 'cpt2' | 'dbn'

export interface FulfillmentWarehouse {
  id: FulfillmentWarehouseId
  city: string
}

/** 物流渠道 / 配送方式 */
export const LOGISTICS_CHANNELS = ['卡派', '快递', '自提'] as const
export type LogisticsChannel = typeof LOGISTICS_CHANNELS[number]

/** 平台选项（UI 展示） */
export const PLATFORM_OPTIONS = ['Takealot', '其他'] as const

export function platformDisplayLabel(platform: string): string {
  return platform === 'Takealot' ? 'Takealot' : '其他'
}

export function matchesPlatformFilter(orderPlatform: string, filter: string): boolean {
  if (filter === 'all') return true
  if (filter === 'Takealot') return orderPlatform === 'Takealot'
  if (filter === '其他') return orderPlatform !== 'Takealot'
  return true
}

/** 海外仓发货仓库（OMS 履约） */
export const FULFILLMENT_WAREHOUSES: FulfillmentWarehouse[] = [
  { id: 'jhb1', city: '约翰内斯堡' },
  { id: 'jhb3', city: '约翰内斯堡' },
  { id: 'cpt1', city: '开普敦' },
  { id: 'cpt2', city: '开普敦' },
  { id: 'dbn', city: '德班' },
]

export const DEFAULT_WAREHOUSE_ID: FulfillmentWarehouseId = 'jhb1'

export function warehouseLabel(id: string): string {
  const w = String(id || '').trim().toLowerCase()
  if (!w || w === 'jhb' || w.includes('wms-jhb')) return 'JHB · 约翰内斯堡'
  const hit = FULFILLMENT_WAREHOUSES.find(x => x.id === w)
  return hit ? `${hit.id.toUpperCase()} · ${hit.city}` : id
}

export function warehouseFilterOptions() {
  return [
    { value: 'all', label: '全部' },
    ...FULFILLMENT_WAREHOUSES.map(w => ({ value: w.id, label: warehouseLabel(w.id) })),
  ]
}

export const takealotWarehouses = [
  { id: 'jnb', name: 'Takealot JNB 仓', city: 'Johannesburg' },
  { id: 'cpt', name: 'Takealot CPT 仓', city: 'Cape Town' },
  { id: 'dbn', name: 'Takealot DBN 仓', city: 'Durban' },
]

Object.assign(statusLabels, {
  pending: '待处理', locked: '已锁库存', picking: '拣货中', shipped: '已发货',
  draft: '草稿', receiving: '收货中', partial: '部分收货', completed: '收货完成', shelved: '上架完成',
  on_the_way: '在途',
  deprecated: '已停用', unpaid: '待支付', paid: '已支付', overdue: '已逾期',
  unmapped: '待绑定', barcode_mismatch: '条码不一致',
  inspecting: '质检中', received: '已收货', active: '生效中',
  connected: '已连接', sync_fail: '同步异常', disconnected: '未连接', disabled: '已停用',
  available: '可用', discarded: '废弃', reviewing: '审核中',
  platform_order: '平台订单', catalog_dist: '货盘分销', manual: '手工录入',
  owned: '自有库存', catalog: '货盘库存',
})
Object.assign(statusColors, {
  connected: 'bg-emerald-100 text-emerald-800',
  sync_fail: 'bg-red-100 text-red-800',
  disconnected: 'bg-slate-100 text-slate-600',
  disabled: 'bg-slate-100 text-slate-500',
  available: 'bg-emerald-100 text-emerald-800',
  platform_order: 'bg-sky-100 text-sky-800',
  catalog_dist: 'bg-emerald-100 text-emerald-800',
  manual: 'bg-violet-100 text-violet-800',
  owned: 'bg-sky-100 text-sky-800',
  catalog: 'bg-amber-100 text-amber-800',
  draft: 'bg-slate-100 text-slate-600',
  discarded: 'bg-slate-100 text-slate-500',
  reviewing: 'bg-amber-100 text-amber-800',
  cancelled: 'bg-slate-100 text-slate-500',
  shelved: 'bg-emerald-100 text-emerald-800',
  on_the_way: 'bg-blue-100 text-blue-800',
})
