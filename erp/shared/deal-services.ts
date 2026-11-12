/** Stable service codes. Snapshot the name on each deal; never infer codes for legacy shop types. */
export const DEAL_SERVICES = [
  { code: 'A1', name: '跨境店', group: 'A 类服务' },
  { code: 'A2', name: '跨境店＋代操作其他平台链接', group: 'A 类服务' },
  { code: 'A3', name: '跨境店＋平台链接＋代收回款（1%）', group: 'A 类服务' },
  { code: 'A4', name: '跨境本土店（代收回款 1%）', group: 'A 类服务' },
  { code: 'A5', name: '跨境本土店（南非公司注册＋公户，XT 回款）', group: 'A 类服务' },
  { code: 'A6', name: '纯本土店', group: 'A 类服务' },
  { code: 'B1', name: '跨境店', group: 'B 类服务' },
  { code: 'B2', name: '本土店', group: 'B 类服务' },
  { code: 'C1', name: '货盘使用押金', group: '货盘服务' },
  { code: 'C2', name: '货盘首充金额', group: '货盘服务' },
  { code: 'D1', name: '南非公司注册', group: '公司与公户' },
  { code: 'D2', name: '南非公户办理', group: '公司与公户' },
  { code: 'D3', name: '自有南非公司单下本土店', group: '公司与公户' },
  { code: 'F1', name: 'TM 标', group: '商标服务' },
  { code: 'F2', name: 'R 标', group: '商标服务' },
  { code: 'G1', name: 'LOA 认证', group: '认证服务' },
  { code: 'G2', name: 'ICASA 认证', group: '认证服务' },
  { code: 'G3', name: 'SABS 认证', group: '认证服务' },
  { code: 'H1', name: 'Takealot 教培陪跑', group: '教培陪跑' },
] as const
export function findDealService(code: unknown) {
  return DEAL_SERVICES.find(service => service.code === code)
}
export function dealServiceLabel(deal: { serviceCode?: string | null; serviceName?: string | null; productDesc?: string | null }) {
  const name = deal.serviceName || deal.productDesc || '未登记服务'
  return deal.serviceCode ? `${deal.serviceCode}｜${name}` : `${name}（历史类型）`
}
