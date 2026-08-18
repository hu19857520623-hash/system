import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { toCsv } from '../../common/csv.util'

@Injectable()
export class AsyncIoExportService {
  constructor(private prisma: PrismaService) {}

  async runExport(module: string, _params?: Record<string, unknown>) {
    switch (module) {
      case '库存':
      case 'inventory':
        return this.exportInventory()
      case '同步日志':
      case 'sync':
        return this.exportSyncLogs()
      case '成本台账':
      case 'cost':
        return this.exportCostLedger()
      case '获客报表':
      case 'leads_report':
        return this.exportLeadsReport()
      case '客户充值':
      case 'customers':
        return this.exportCustomers()
      case '海运账单':
      case 'freight':
        return this.exportFreightBills()
      case '客户结算':
      case 'billing':
        return this.exportBilling()
      case '成交客户':
      case 'leads_deals':
        return this.exportLeadsDeals()
      case '中转仓库存':
      case 'logistics_inventory':
        return this.exportInventory('logistics')
      default:
        return this.exportGeneric(module)
    }
  }

  private async exportInventory(warehouseType?: string) {
    const warehouseCodes = warehouseType
      ? (await this.prisma.warehouse.findMany({
          where: { warehouseType },
          select: { warehouseCode: true },
        })).map((w) => w.warehouseCode)
      : null
    const rows = await this.prisma.inventory.findMany({
      where: warehouseCodes?.length ? { warehouseCode: { in: warehouseCodes } } : warehouseType ? { warehouseCode: '__none__' } : undefined,
      take: 5000,
      orderBy: { id: 'desc' },
    })
    const products = await this.prisma.product.findMany({
      where: { id: { in: rows.map((r) => r.productId) } },
    })
    const prodMap = new Map(products.map((p) => [Number(p.id), p]))
    const headers = ['仓库', 'SKU', '商品名', '规格', '总量', '可用', '锁定']
    const data = rows.map((r) => {
      const p = prodMap.get(Number(r.productId))
      return [r.warehouseCode, r.sku, p?.productName || '', p?.spec || '', r.totalQty, r.availableQty, r.lockedQty]
    })
    const prefix = warehouseType === 'logistics' ? '中转仓库存' : '库存'
    return { fileName: `${prefix}_${Date.now()}.csv`, content: toCsv(headers, data), totalRows: data.length }
  }

  private async exportSyncLogs() {
    const rows = await this.prisma.syncLog.findMany({ take: 5000, orderBy: { id: 'desc' } })
    const headers = ['ID', '类型', '目标', '关联单号', '状态', '错误', '重试', '时间']
    const data = rows.map((r) => [
      Number(r.id), r.syncType, r.targetSystem, r.referenceNo || '', r.status,
      r.errorMessage || '', r.retryCount ?? 0, r.createdAt.toISOString(),
    ])
    return { fileName: `同步日志_${Date.now()}.csv`, content: toCsv(headers, data), totalRows: data.length }
  }

  private async exportCostLedger() {
    const rows = await this.prisma.costLedger.findMany({ take: 5000, orderBy: { id: 'desc' } })
    const headers = ['成本编号', 'SKU', '类型', '金额(RMB)', '关联单号', '日期', '备注']
    const data = rows.map((r) => [
      r.costNo, r.sku || '', r.costType, r.amountRmb, r.referenceNo || '',
      r.costDate.toISOString().slice(0, 10), r.remark || '',
    ])
    return { fileName: `成本台账_${Date.now()}.csv`, content: toCsv(headers, data), totalRows: data.length }
  }

  private async exportLeadsReport() {
    const leads = await this.prisma.lead.findMany()
    const bySource: Record<string, number> = {}
    leads.forEach((l) => { bySource[l.source || '其他'] = (bySource[l.source || '其他'] || 0) + 1 })
    const headers = ['来源', '线索数']
    const data = Object.entries(bySource).map(([k, v]) => [k, v])
    return { fileName: `获客报表_${Date.now()}.csv`, content: toCsv(headers, data), totalRows: data.length }
  }

  private async exportCustomers() {
    const rows = await this.prisma.customer.findMany({ take: 5000, orderBy: { id: 'desc' } })
    const headers = ['编码', '客户名', '联系人', '余额', '状态']
    const data = rows.map((r) => [
      r.customerCode, r.customerName, r.contactName || '', r.balance,
      r.status === 1 ? '正常' : '停用',
    ])
    return { fileName: `客户充值_${Date.now()}.csv`, content: toCsv(headers, data), totalRows: data.length }
  }

  private async exportFreightBills() {
    const rows = await this.prisma.supplierFreightBill.findMany({ take: 5000, orderBy: { id: 'desc' } })
    const headers = ['账单号', '供应商ID', '月份', '金额', '柜数', '状态', '备注']
    const data = rows.map((r) => [
      r.billNo, Number(r.supplierId), r.billMonth || '', r.totalAmount, r.containerCount, r.status, r.remark || '',
    ])
    return { fileName: `海运账单_${Date.now()}.csv`, content: toCsv(headers, data), totalRows: data.length }
  }

  private async exportBilling() {
    const rows = await this.prisma.billingOrder.findMany({ include: { items: true }, take: 2000, orderBy: { id: 'desc' } })
    const headers = ['账单号', '客户ID', '月份', '总金额', '状态', '明细行数']
    const data = rows.map((r) => [r.billingNo, Number(r.customerId), r.billingMonth || '', r.totalAmount, r.status, r.items.length])
    return { fileName: `客户结算_${Date.now()}.csv`, content: toCsv(headers, data), totalRows: data.length }
  }

  private async exportLeadsDeals() {
    const rows = await this.prisma.lead.findMany({ where: { status: 'deal' }, take: 5000 })
    const headers = ['线索号', '公司', '联系方式', '电话', '来源']
    const data = rows.map((r) => [r.leadNo, r.companyName, r.contactName || '', r.contactPhone || '', r.source || ''])
    return { fileName: `成交客户_${Date.now()}.csv`, content: toCsv(headers, data), totalRows: data.length }
  }

  private async exportGeneric(module: string) {
    const headers = ['模块', '导出时间', '说明']
    const data = [[module, new Date().toISOString(), 'ERP 数据导出']]
    return { fileName: `${module}_${Date.now()}.csv`, content: toCsv(headers, data), totalRows: data.length }
  }
}
