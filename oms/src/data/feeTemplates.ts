import type { LogisticsChannel } from './mockData'

export interface SkuDimensions {
  lengthCm: number
  widthCm: number
  heightCm: number
  weightKg: number
}

export interface OutboundFeeLine {
  type: 'handling' | 'shipping'
  label: string
  amount: number
  detail: string
}

/** 物流目的地区代码（可扩展，不限于 JHB/CPT/DBN） */
export type ShippingRegion = string

export const DEFAULT_SHIPPING_REGION_CODES = ['jhb', 'cpt', 'dbn'] as const

export const SHIPPING_REGION_LABELS: Record<string, string> = {
  jhb: 'JHB 约翰内斯堡',
  cpt: 'CPT 开普敦',
  dbn: 'DBN 德班',
}

/** @deprecated 使用 regionDispatchRules 动态列表 */
export const SHIPPING_REGIONS: string[] = [...DEFAULT_SHIPPING_REGION_CODES]

/** 地区模板：发往某地区时默认使用的配送方式（卡派 / 快递） */
export type RegionDispatchMethod = '卡派' | '快递'

export interface RegionDispatchRule {
  id: string
  /** 地区代码，如 jhb / cpt / pe */
  code: string
  /** 展示名称 */
  label: string
  shippingMethod: RegionDispatchMethod
  enabled: boolean
  remark?: string
}

export const DEFAULT_REGION_DISPATCH_RULES: RegionDispatchRule[] = [
  { id: 'rd-jhb', code: 'jhb', label: 'JHB 约翰内斯堡', shippingMethod: '卡派', enabled: true, remark: 'JHB 区内及周边大件' },
  { id: 'rd-cpt', code: 'cpt', label: 'CPT 开普敦', shippingMethod: '卡派', enabled: true, remark: '跨区发往开普敦' },
  { id: 'rd-dbn', code: 'dbn', label: 'DBN 德班', shippingMethod: '快递', enabled: true, remark: '德班方向小件快递' },
]

export function regionLabel(code: string, rules: RegionDispatchRule[] = DEFAULT_REGION_DISPATCH_RULES): string {
  return rules.find(r => r.code === code)?.label ?? SHIPPING_REGION_LABELS[code] ?? code.toUpperCase()
}

export function regionDispatchLabel(rule: RegionDispatchRule): string {
  return `${rule.label} · ${rule.shippingMethod}`
}

export function findDispatchRuleForRegion(
  rules: RegionDispatchRule[],
  code: string,
): RegionDispatchRule | undefined {
  return rules.find(r => r.enabled && r.code === code)
}

export function enabledDispatchRules(rules: RegionDispatchRule[]): RegionDispatchRule[] {
  return rules.filter(r => r.enabled)
}

export function normalizeRegionDispatchRules(raw: unknown[]): RegionDispatchRule[] {
  return raw.map(item => {
    const r = item as RegionDispatchRule & { region?: string }
    const code = (r.code ?? r.region ?? '').toLowerCase().trim()
    return {
      id: r.id || `rd-${code}-${Date.now()}`,
      code,
      label: r.label ?? SHIPPING_REGION_LABELS[code] ?? code.toUpperCase(),
      shippingMethod: r.shippingMethod ?? '卡派',
      enabled: r.enabled ?? true,
      remark: r.remark,
    }
  }).filter(r => r.code)
}

export interface ChannelShippingRule {
  mode: 'volume' | 'weight'
  ratePerCbm?: number
  ratePerKg?: number
  minCharge: number
}

export type RegionShippingRates = Record<'卡派' | '快递', ChannelShippingRule>

/** 自提费 — 按目的地区配置（每单 + 每件，含最低收费） */
export interface PickupRegionRule {
  perOrder: number
  perUnit: number
  minCharge: number
}

/** 出库价格模板 — 按收货地区独立维护，提交出库单时按 SKU 尺寸 + 目的地区预扣操作费 / 物流费 / 自提费 */
export interface PriceTemplate {
  id: string
  name: string
  /** 所属收货地区（jhb / cpt / dbn） */
  regionCode: string
  warehouseId: string
  status: 'active' | 'draft'
  handling: {
    perOrderBase: number
    perUnit: number
    perSkuLine: number
  }
  /** 物流费 × 配送方式（卡派/快递），仅含本模板所属地区 */
  shippingByRegion: Record<string, RegionShippingRates>
  /** 自提费，仅含本模板所属地区 */
  pickupByRegion: Record<string, PickupRegionRule>
  updatedAt: string
}

/** 仓租模板 — 按库存体积 / 件数每日计费 */
export interface StorageRentTemplate {
  id: string
  name: string
  warehouseId: string
  status: 'active' | 'draft'
  billingUnit: 'volume' | 'piece'
  pricePerCbmPerDay: number
  pricePerPiecePerDay: number
  minChargePerDay: number
  freeStorageDays: number
  updatedAt: string
}

function regionRates(
  truckCbm: number, truckMin: number,
  expressKg: number, expressMin: number,
): RegionShippingRates {
  return {
    卡派: { mode: 'volume', ratePerCbm: truckCbm, minCharge: truckMin },
    快递: { mode: 'weight', ratePerKg: expressKg, minCharge: expressMin },
  }
}

function pickupRule(perOrder: number, perUnit: number, minCharge: number): PickupRegionRule {
  return { perOrder, perUnit, minCharge }
}

function createRegionPriceTemplate(
  id: string,
  name: string,
  regionCode: string,
  handling: PriceTemplate['handling'],
  truckCbm: number, truckMin: number,
  expressKg: number, expressMin: number,
  pickup: PickupRegionRule,
  status: 'active' | 'draft' = 'active',
): PriceTemplate {
  return {
    id,
    name,
    regionCode,
    warehouseId: 'jhb',
    status,
    handling,
    shippingByRegion: { [regionCode]: regionRates(truckCbm, truckMin, expressKg, expressMin) },
    pickupByRegion: { [regionCode]: pickup },
    updatedAt: '2026-07-01',
  }
}

const STD_HANDLING = { perOrderBase: 8, perUnit: 1.2, perSkuLine: 2 }
const VIP_HANDLING = { perOrderBase: 6, perUnit: 1.0, perSkuLine: 1.5 }

export const DEFAULT_PRICE_TEMPLATE = createRegionPriceTemplate(
  'pt-jhb-std', 'JHB 标准价', 'jhb',
  STD_HANDLING, 580, 30, 16, 22, pickupRule(12, 0.8, 10),
)

/** @deprecated 兼容旧 ID，等同 JHB 标准价 */
export const DEFAULT_PRICE_TEMPLATE_LEGACY = DEFAULT_PRICE_TEMPLATE

export const DEFAULT_PRICE_TEMPLATE_VIP = createRegionPriceTemplate(
  'pt-jhb-vip', 'JHB VIP价', 'jhb',
  VIP_HANDLING, 520, 28, 14, 20, pickupRule(8, 0.5, 8),
)

export const DEFAULT_PRICE_TEMPLATES: PriceTemplate[] = [
  DEFAULT_PRICE_TEMPLATE,
  DEFAULT_PRICE_TEMPLATE_VIP,
  createRegionPriceTemplate('pt-cpt-std', 'CPT 标准价', 'cpt', STD_HANDLING, 720, 35, 20, 28, pickupRule(18, 1.0, 15)),
  createRegionPriceTemplate('pt-cpt-vip', 'CPT VIP价', 'cpt', VIP_HANDLING, 680, 32, 18, 25, pickupRule(12, 0.7, 10)),
  createRegionPriceTemplate('pt-dbn-std', 'DBN 标准价', 'dbn', STD_HANDLING, 650, 32, 18, 25, pickupRule(15, 0.9, 12)),
  createRegionPriceTemplate('pt-dbn-vip', 'DBN VIP价', 'dbn', VIP_HANDLING, 600, 30, 16, 22, pickupRule(10, 0.6, 9)),
]

/** 客户按收货地区绑定的价格模板 ID */
export type PriceTemplateByRegion = Partial<Record<string, string | null>>

export function emptyPriceTemplateByRegion(): Record<string, string | null> {
  return Object.fromEntries(DEFAULT_SHIPPING_REGION_CODES.map(c => [c, null]))
}

/** 解析客户在各地区的模板绑定（兼容旧版单一 priceTemplateId） */
export function resolveCustomerPriceTemplateBindings(
  priceTemplateByRegion?: PriceTemplateByRegion | null,
  legacyPriceTemplateId?: string | null,
): Record<string, string | null> {
  const result = emptyPriceTemplateByRegion()
  if (priceTemplateByRegion) {
    for (const code of DEFAULT_SHIPPING_REGION_CODES) {
      if (priceTemplateByRegion[code]) result[code] = priceTemplateByRegion[code]!
    }
  }
  const hasAny = DEFAULT_SHIPPING_REGION_CODES.some(c => result[c])
  if (!hasAny && legacyPriceTemplateId) {
    for (const code of DEFAULT_SHIPPING_REGION_CODES) {
      result[code] = legacyPriceTemplateId
    }
  }
  return result
}

export function inferTemplateRegionCode(raw: Partial<PriceTemplate>): string {
  if (raw.regionCode) return raw.regionCode.toLowerCase()
  const id = (raw.id ?? '').toLowerCase()
  if (id.includes('cpt')) return 'cpt'
  if (id.includes('dbn')) return 'dbn'
  return 'jhb'
}

export const DEFAULT_STORAGE_TEMPLATE: StorageRentTemplate = {
  id: 'st-jhb-default',
  name: 'jhb1 标准仓租',
  warehouseId: 'jhb',
  status: 'active',
  billingUnit: 'volume',
  pricePerCbmPerDay: 2.8,
  pricePerPiecePerDay: 0.06,
  minChargePerDay: 5,
  freeStorageDays: 30,
  updatedAt: '2026-07-01',
}

/** Takealot 目的仓 ID → 计费地区代码 */
export function warehouseIdToRegion(warehouseId: string): string {
  if (warehouseId.startsWith('cpt')) return 'cpt'
  if (warehouseId.startsWith('dbn')) return 'dbn'
  return 'jhb'
}

export function defaultRegionShippingRates(): RegionShippingRates {
  return regionRates(650, 32, 18, 25)
}

export function defaultPickupRegionRule(): PickupRegionRule {
  return pickupRule(15, 0.8, 10)
}

export function calcSkuVolumeM3(d: SkuDimensions, qty: number): number {
  return (d.lengthCm * d.widthCm * d.heightCm / 1_000_000) * qty
}

export function calcSkuWeightKg(d: SkuDimensions, qty: number): number {
  return d.weightKg * qty
}

/** 估算单 SKU 日仓租（用于库存侧展示） */
export function estimateDailyStorageRent(
  dims: SkuDimensions,
  qty: number,
  template: StorageRentTemplate = DEFAULT_STORAGE_TEMPLATE,
): number {
  let rent = 0
  if (template.billingUnit === 'volume') {
    rent = calcSkuVolumeM3(dims, qty) * template.pricePerCbmPerDay
  } else {
    rent = qty * template.pricePerPiecePerDay
  }
  return Math.max(template.minChargePerDay, rent)
}

export function calculateOutboundPreDeduct(
  lines: { sku: string; qty: number }[],
  shippingMethod: string,
  destRegion: string,
  getDimensions: (sku: string) => SkuDimensions | undefined,
  priceTemplate: PriceTemplate = DEFAULT_PRICE_TEMPLATE,
  regionRules: RegionDispatchRule[] = DEFAULT_REGION_DISPATCH_RULES,
): {
  lines: OutboundFeeLine[]
  total: number
  totalVolumeM3: number
  totalWeightKg: number
  destRegion: string
  pickupOnly: boolean
} {
  let totalVolumeM3 = 0
  let totalWeightKg = 0
  let totalQty = 0

  for (const line of lines) {
    const dims = getDimensions(line.sku) ?? { lengthCm: 10, widthCm: 10, heightCm: 10, weightKg: 0.5 }
    totalVolumeM3 += calcSkuVolumeM3(dims, line.qty)
    totalWeightKg += calcSkuWeightKg(dims, line.qty)
    totalQty += line.qty
  }

  const feeLines: OutboundFeeLine[] = []
  const destRegionLabel = regionLabel(destRegion, regionRules)

  const handling = priceTemplate.handling.perOrderBase
    + priceTemplate.handling.perUnit * totalQty
    + priceTemplate.handling.perSkuLine * lines.length

  feeLines.push({
    type: 'handling',
    label: '操作费',
    amount: round2(handling),
    detail: `基础 ¥${priceTemplate.handling.perOrderBase} + ${totalQty} 件 × ¥${priceTemplate.handling.perUnit} + ${lines.length} SKU × ¥${priceTemplate.handling.perSkuLine}`,
  })

  const pickupOnly = shippingMethod === '自提'

  if (pickupOnly) {
    const pickupRule = priceTemplate.pickupByRegion?.[destRegion] ?? defaultPickupRegionRule()
    const pickup = Math.max(
      pickupRule.minCharge,
      pickupRule.perOrder + pickupRule.perUnit * totalQty,
    )
    feeLines.push({
      type: 'shipping',
      label: '自提费',
      amount: round2(pickup),
      detail: `${destRegionLabel} · 自提 · 基础 ¥${pickupRule.perOrder} + ${totalQty} 件 × ¥${pickupRule.perUnit}`,
    })
  } else {
    const channel = (shippingMethod === '卡派' ? '卡派' : '快递') as '卡派' | '快递'
    const rates = priceTemplate.shippingByRegion[destRegion] ?? defaultRegionShippingRates()
    const channelRule = rates[channel] ?? rates['快递']

    let shipping = 0
    let shippingDetail = ''

    if (channelRule.mode === 'volume') {
      shipping = Math.max(channelRule.minCharge, totalVolumeM3 * (channelRule.ratePerCbm ?? 0))
      shippingDetail = `${destRegionLabel} · ${channel} · 体积 ${totalVolumeM3.toFixed(4)} m³ × ¥${channelRule.ratePerCbm}/m³`
    } else {
      shipping = Math.max(channelRule.minCharge, totalWeightKg * (channelRule.ratePerKg ?? 0))
      shippingDetail = `${destRegionLabel} · ${channel} · 重量 ${totalWeightKg.toFixed(2)} kg × ¥${channelRule.ratePerKg}/kg`
    }

    feeLines.push({
      type: 'shipping',
      label: '物流费',
      amount: round2(shipping),
      detail: shippingDetail,
    })
  }

  const total = round2(feeLines.reduce((s, f) => s + f.amount, 0))
  return { lines: feeLines, total, totalVolumeM3, totalWeightKg, destRegion, pickupOnly }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** P6-2：生成 ERP 实算所需的价格模板快照 */
export function buildOutboundTemplateSnapshot(
  priceTemplate: PriceTemplate,
  destRegion: string,
  shippingMethod: string,
) {
  const pickupOnly = shippingMethod === '自提'
  const channel = (shippingMethod === '卡派' ? '卡派' : '快递') as '卡派' | '快递'
  const rates = priceTemplate.shippingByRegion[destRegion] ?? defaultRegionShippingRates()
  const channelRule = rates[channel] ?? rates['快递']
  const pickup = priceTemplate.pickupByRegion?.[destRegion] ?? defaultPickupRegionRule()
  return {
    handling: { ...priceTemplate.handling },
    shipping: pickupOnly
      ? { mode: 'volume' as const, ratePerCbm: 0, minCharge: 0 }
      : {
          mode: channelRule.mode,
          ratePerCbm: channelRule.ratePerCbm,
          ratePerKg: channelRule.ratePerKg,
          minCharge: channelRule.minCharge,
        },
    pickup: { ...pickup },
    shippingMethod,
    destRegion,
  }
}

export function logisticsChannelLabel(channel: LogisticsChannel | string): string {
  return channel
}

/** 同步价格模板中的地区费率（仅维护模板所属地区） */
export function syncPriceTemplateRegions(
  priceTemplate: PriceTemplate,
  rules: RegionDispatchRule[],
): PriceTemplate {
  const regionCode = inferTemplateRegionCode(priceTemplate)
  const shippingByRegion = { ...priceTemplate.shippingByRegion }
  const pickupByRegion = { ...(priceTemplate.pickupByRegion ?? {}) }
  const rule = rules.find(r => r.enabled && r.code === regionCode)
  if (rule) {
    if (!shippingByRegion[regionCode]) {
      shippingByRegion[regionCode] = defaultRegionShippingRates()
    }
    if (!pickupByRegion[regionCode]) {
      pickupByRegion[regionCode] = defaultPickupRegionRule()
    }
  }
  return { ...priceTemplate, regionCode, shippingByRegion, pickupByRegion }
}

/** 兼容旧版 localStorage / 数据库中的综合模板结构 */
export function normalizePriceTemplate(raw: Partial<PriceTemplate> & { shippingChannels?: unknown }): PriceTemplate {
  const regionCode = inferTemplateRegionCode(raw)
  const base = { ...DEFAULT_PRICE_TEMPLATE, ...raw, regionCode }
  const legacyShipping = raw.shippingByRegion ?? DEFAULT_PRICE_TEMPLATE.shippingByRegion
  const legacyPickup = raw.pickupByRegion ?? DEFAULT_PRICE_TEMPLATE.pickupByRegion
  return {
    ...base,
    shippingByRegion: {
      [regionCode]: legacyShipping[regionCode] ?? defaultRegionShippingRates(),
    },
    pickupByRegion: {
      [regionCode]: legacyPickup?.[regionCode] ?? defaultPickupRegionRule(),
    },
  }
}

/** 充值支付方式 */
export type PaymentMethodType = 'bank_transfer' | 'alipay' | 'wechat'

export interface PaymentMethod {
  id: string
  type: PaymentMethodType
  title: string
  enabled: boolean
  sortOrder: number
  bankName?: string
  accountName?: string
  accountNumber?: string
  branch?: string
  swiftCode?: string
  qrCodeUrl?: string
  accountId?: string
  customText: string
  updatedAt: string
}

export const PAYMENT_METHOD_TYPE_LABELS: Record<PaymentMethodType, string> = {
  bank_transfer: '对公转账',
  alipay: '支付宝',
  wechat: '微信支付',
}

export const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: 'pm-bank',
    type: 'bank_transfer',
    title: '对公转账',
    enabled: true,
    sortOrder: 0,
    bankName: '',
    accountName: '',
    accountNumber: '',
    branch: '',
    swiftCode: '',
    customText: '请在转账备注中填写客户编码，到账后联系客服确认入账。',
    updatedAt: '',
  },
  {
    id: 'pm-alipay',
    type: 'alipay',
    title: '支付宝',
    enabled: true,
    sortOrder: 1,
    qrCodeUrl: '',
    accountId: '',
    customText: '扫码或转账至上述支付宝账号，备注填写客户编码。',
    updatedAt: '',
  },
  {
    id: 'pm-wechat',
    type: 'wechat',
    title: '微信支付',
    enabled: true,
    sortOrder: 2,
    qrCodeUrl: '',
    accountId: '',
    customText: '微信扫码支付，备注填写客户编码。',
    updatedAt: '',
  },
]

/** @deprecated 使用 PaymentMethod */
export type RechargeTemplate = PaymentMethod & {
  bankName: string
  accountName: string
  accountNumber: string
  branch: string
  swiftCode: string
}

/** @deprecated 使用 DEFAULT_PAYMENT_METHODS[0] */
export const DEFAULT_RECHARGE_TEMPLATE: RechargeTemplate = {
  ...DEFAULT_PAYMENT_METHODS[0],
  bankName: DEFAULT_PAYMENT_METHODS[0].bankName!,
  accountName: DEFAULT_PAYMENT_METHODS[0].accountName!,
  accountNumber: DEFAULT_PAYMENT_METHODS[0].accountNumber!,
  branch: DEFAULT_PAYMENT_METHODS[0].branch ?? '',
  swiftCode: DEFAULT_PAYMENT_METHODS[0].swiftCode ?? '',
}
