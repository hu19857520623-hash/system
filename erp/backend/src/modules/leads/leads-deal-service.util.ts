import { BadRequestException } from '@nestjs/common'
import { findDealService } from '@erp/shared/deal-services'

export function resolveDealService(data: any) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BadRequestException('请选择一项成交服务')
  if (Object.prototype.hasOwnProperty.call(data, 'serviceCode')) {
    const service = findDealService(data.serviceCode)
    if (!service) throw new BadRequestException('请选择一项有效成交服务，不支持一次选择多个服务')
    return { serviceCode: service.code, serviceName: service.name, productDesc: service.name }
  }
  // Compatibility for old clients only. Do not guess A1/B1 or rewrite historical records.
  if (['本土店', '跨境店', '海外仓'].includes(data.productDesc)) return { productDesc: data.productDesc }
  throw new BadRequestException('请选择一项成交服务')
}
export function dealServiceWhere(query: string) {
  return { OR: [
    { serviceCode: { contains: query } },
    { serviceName: { contains: query } },
    { productDesc: { contains: query } },
  ] }
}

/** One row per deal, with the original amount; a customer's multiple services must never collapse. */
export function dealServiceExportRows(leads: any[]): any[][] {
  const text = (value: unknown) => {
    const s = String(value ?? '')
    return /^[\s]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s) ? "'" + s : s
  }
  return leads.flatMap(lead => (lead.deals || []).map((deal: any) => [
    lead.leadNo, lead.companyName, lead.contactName || '', lead.contactPhone ? "'" + lead.contactPhone : '', lead.source || '',
    deal.dealNo, deal.serviceCode || '', deal.serviceName || deal.productDesc || '未登记服务',
    deal.dealDate ? new Date(deal.dealDate).toISOString().slice(0, 10) : '',
    deal.dealAmount == null ? '' : String(deal.dealAmount), deal.remark || '',
  ].map((value, index) => index === 9 ? value : text(value))))
}
