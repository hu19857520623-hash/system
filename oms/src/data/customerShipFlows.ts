import type { OmsRole } from '../auth/permissions'
import {
  TAKEALOT_ATTACHMENT_KINDS,
  TAKEALOT_ATTACHMENT_KIND_LABELS,
} from './mockData'

/** 来源：《电商及货盘客户发货流程.docx》 */
export type FlowKind = 'ecommerce' | 'catalog' | 'manual'

export interface ShipFlowStep {
  id: string
  order: number
  title: string
  desc: string
  /** OMS 内跳转；开户等线下步骤无 route */
  route?: string
  /** 需在 Takealot 等外部平台完成的步骤 */
  external?: boolean
  externalLabel?: string
  module: string
}

export const MANUAL_PLATFORMS = ['Makro', 'Temu'] as const

/** 电商客户：自有商品 → 入库 → Takealot 预约 → OMS 出库 */
export const ECOMMERCE_SHIP_FLOW: ShipFlowStep[] = [
  { id: 'open', order: 1, title: 'OMS 开户', desc: '联系工作人员开通 OMS 账号，管理员分配模块权限', module: '账号与报表中心' },
  { id: 'recharge', order: 2, title: '充值余额', desc: '账户充值后用于仓储、操作与物流费用扣款', route: '/billing/recharge', module: '平台与费用中心' },
  { id: 'product', order: 3, title: '创建商品信息', desc: '维护 SKU、申报信息、规格与绑码', route: '/products/new', module: '商品与编码中心' },
  { id: 'inbound-create', order: 4, title: '预约入库', desc: '填写入库预报单：目的仓、预计到货与货品明细', route: '/inbound', module: '仓储履约预约中心' },
  { id: 'inbound-labels', order: 5, title: '打印箱唛与 SKU 标签', desc: '提交后在入库记录详情下载/打印标签，贴于外箱后发往海外仓', route: '/inbound/records', module: '仓储履约预约中心' },
  { id: 'inbound-receive', order: 6, title: '海外仓入库验收', desc: '在入库记录中跟踪在途、收货与上架进度', route: '/inbound/records', module: '仓储履约预约中心' },
  {
    id: 'takealot-prep', order: 7, title: 'Takealot 预约发货', desc: '在 Takealot 预约入仓时间，并下载外箱标、SKU 标签、清单、预约单',
    external: true, externalLabel: 'Takealot Seller Portal', module: 'Takealot 平台',
  },
  { id: 'oms-outbound', order: 8, title: 'OMS 下发出库单', desc: '在 OMS 创建出库单，上传 Takealot 下载的文件（外箱标/标签/清单/预约单）', route: '/outbound', module: '仓储履约预约中心' },
  { id: 'wh-ship', order: 9, title: '海外仓发货 · 回传单号', desc: '海外仓打包发货，物流单号与签收单在订单与出库中查看', route: '/outbound/records', module: '仓储履约预约中心' },
]

/** 货盘客户：选品购货 → Takealot 预约 → OMS 出库 */
export const CATALOG_SHIP_FLOW: ShipFlowStep[] = [
  { id: 'open', order: 1, title: 'OMS 开户', desc: '联系工作人员开通 OMS 账号', module: '账号与报表中心' },
  { id: 'recharge', order: 2, title: '充值余额', desc: '充值后用于货盘购货与履约费用', route: '/billing/recharge', module: '平台与费用中心' },
  { id: 'catalog-buy', order: 3, title: '货盘选品购买', desc: '在 OMS 货盘选品并下单购货，形成货盘库存', route: '/catalog', module: '商品与编码中心' },
  {
    id: 'takealot-prep', order: 4, title: 'Takealot 预约发货', desc: '在 Takealot 预约入仓时间，下载外箱标、SKU 标签、清单、预约单',
    external: true, externalLabel: 'Takealot Seller Portal', module: 'Takealot 平台',
  },
  { id: 'oms-outbound', order: 5, title: 'OMS 下发出库单', desc: '创建出库单（来源=货盘分销），上传 Takealot 文件', route: '/outbound', module: '仓储履约预约中心' },
  { id: 'wh-ship', order: 6, title: '海外仓发货 · 回传单号', desc: '海外仓执行发货，回传快递单号与签收单', route: '/outbound/records', module: '仓储履约预约中心' },
]

/** 手工订单：其他平台（Makro、Temu 等），不经 Takealot */
export const MANUAL_SHIP_FLOW: ShipFlowStep[] = [
  { id: 'open', order: 1, title: 'OMS 开户', desc: '联系工作人员开通 OMS 账号', module: '账号与报表中心' },
  { id: 'recharge', order: 2, title: '充值余额', desc: '账户充值', route: '/billing/recharge', module: '平台与费用中心' },
  { id: 'product', order: 3, title: '商品与入库', desc: '创建商品并完成入库（自有库存）', route: '/inbound', module: '仓储履约预约中心' },
  { id: 'oms-outbound', order: 4, title: 'OMS 手工出库', desc: `创建出库单（来源=手工录入），适用 ${MANUAL_PLATFORMS.join('、')} 等非 Takealot 平台`, route: '/outbound', module: '仓储履约预约中心' },
  { id: 'wh-ship', order: 5, title: '海外仓发货 · 回传单号', desc: '海外仓发货并回传物流单号与 POD', route: '/outbound/records', module: '仓储履约预约中心' },
]

export const TAKEALOT_DOWNLOAD_ITEMS = [
  {
    fileType: TAKEALOT_ATTACHMENT_KINDS.outerLabel,
    label: TAKEALOT_ATTACHMENT_KIND_LABELS.outerLabel,
  },
  {
    fileType: TAKEALOT_ATTACHMENT_KINDS.skuLabel,
    label: TAKEALOT_ATTACHMENT_KIND_LABELS.skuLabel,
  },
  {
    fileType: TAKEALOT_ATTACHMENT_KINDS.deliveryList,
    label: TAKEALOT_ATTACHMENT_KIND_LABELS.deliveryList,
  },
  {
    fileType: TAKEALOT_ATTACHMENT_KINDS.appointment,
    label: TAKEALOT_ATTACHMENT_KIND_LABELS.appointment,
  },
] as const

export const INBOUND_DOWNLOAD_ITEMS = ['箱唛', 'SKU 标签'] as const

export function shipFlowForRole(role: OmsRole): { kind: FlowKind; label: string; steps: ShipFlowStep[] }[] {
  if (role === 'ecommerce') {
    return [{ kind: 'ecommerce', label: '电商客户发货流程', steps: ECOMMERCE_SHIP_FLOW }]
  }
  if (role === 'catalog') {
    return [{ kind: 'catalog', label: '货盘客户发货流程', steps: CATALOG_SHIP_FLOW }]
  }
  if (role === 'hybrid') {
    return [
      { kind: 'ecommerce', label: '电商线（Takealot 入仓）', steps: ECOMMERCE_SHIP_FLOW },
      { kind: 'catalog', label: '货盘线（Takealot 入仓）', steps: CATALOG_SHIP_FLOW },
      { kind: 'manual', label: '手工订单（Makro / Temu 等）', steps: MANUAL_SHIP_FLOW },
    ]
  }
  return []
}

export function stepHintForRoute(route: string, role: OmsRole): ShipFlowStep | undefined {
  const flows = shipFlowForRole(role).flatMap(f => f.steps)
  return flows.find(s => s.route === route || s.route?.startsWith(route))
}
