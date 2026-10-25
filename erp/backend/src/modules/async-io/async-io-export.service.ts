import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { toCsv } from '../../common/csv.util'
import { userFacingError } from '@erp/shared/user-facing-error'
import { InventoryService } from '../inventory/inventory.service'
import { CostService } from '../cost/cost.service'
import { CustomersService } from '../customers/customers.service'
import { LeadsService } from '../leads/leads.service'
import type { AuthUser } from '../../common/decorators/current-user.decorator'
import { exportScope } from './async-io-scope.util'

@Injectable()
export class AsyncIoExportService {
  constructor(
    private prisma: PrismaService,
    private inventory: InventoryService,
    private cost: CostService,
    private customers: CustomersService,
    private leads: LeadsService,
  ) {}

  async runExport(module: string, input: Record<string, unknown> = {}, user?: AuthUser) {
    const { key, params } = exportScope(module, input)
    const csv = (headers: string[], rows: any[][]) => {
      if (rows.length > 5000) throw new BadRequestException('导出超过 5000 条，请缩小筛选范围')
      return { fileName: `${module}_${Date.now()}.csv`, content: toCsv(headers, rows), totalRows: rows.length }
    }
    switch (key) {
      case 'inventory':
      case 'logistics_inventory': {
        const { items } = await this.inventory.query({ ...params, ...(key === 'logistics_inventory' ? { warehouseType: 'logistics' } : {}) }, true)
        return csv(['仓库', 'SKU', '商品名', '规格', '总库存', '可用', '锁定'], items.map((r: any) => [r.warehouseCode, r.sku, r.productName, r.spec, r.totalQty, r.availableQty, r.lockedQty]))
      }
      case 'cost': {
        const { items } = await this.cost.list(params, true)
        return csv(['成本编号', 'SKU', '类型', '金额(RMB)', '关联单号', '日期', '备注'], items.map(r => [r.costNo, r.sku || '', r.costType, r.amountRmb, r.referenceNo || '', r.costDate.toISOString().slice(0, 10), r.remark || '']))
      }
      case 'customers': {
        const { items } = await this.customers.list(params, true)
        return csv(['编码', '客户名', '联系人', '余额', '状态'], items.map(r => [r.customerCode, r.customerName, r.contactName || '', r.balance, r.status === 1 ? '正常' : '停用']))
      }
      case 'leads_deals': {
        const { items } = await this.leads.list({ ...params, status: 'deal', assigneeId: params.assigneeId ? Number(params.assigneeId) : undefined }, user, true)
        return csv(['线索号', '公司', '联系人', '电话', '来源'], items.map(r => [r.leadNo, r.companyName, r.contactName || '', r.contactPhone || '', r.source || '']))
      }
      case 'leads_report': {
        const report = await this.leads.report(params.range)
        return csv(['来源', '线索数'], report.bySource.map(r => [r.source, r.count]))
      }
      case 'sync': {
        const rows = await this.prisma.syncLog.findMany({ take: 5001, orderBy: { id: 'desc' } })
        const labels: Record<string, string> = { pending: '待同步', processing: '同步中', success: '成功', completed: '成功', failed: '失败' }
        return csv(['ID', '类型', '目标', '关联单号', '状态', '错误', '重试', '时间'], rows.map(r => [Number(r.id), r.syncType, r.targetSystem, r.referenceNo || '', labels[r.status] || '状态待核对', r.errorMessage ? userFacingError(r.errorMessage) : '', r.retryCount ?? 0, r.createdAt.toISOString()]))
      }
      case 'freight': {
        const rows = await this.prisma.supplierFreightBill.findMany({ where: { source: { not: 'finance_approve' } }, take: 5001, orderBy: { id: 'desc' } })
        const labels: Record<string, string> = { pending: '待审核', approved: '已审核', paid: '已付款', draft: '草稿', confirmed: '已确认', rejected: '已驳回' }
        return csv(['账单号', '供应商ID', '柜号', '月份', '金额', '柜数', '状态', '备注'], rows.map(r => [r.billNo, Number(r.supplierId), r.containerNo || '', r.billMonth || '', r.totalAmount, r.containerCount, labels[r.status] || '状态待核对', r.remark || '']))
      }
      case 'billing': {
        const rows = await this.prisma.billingOrder.findMany({ include: { items: true }, take: 5001, orderBy: { id: 'desc' } })
        const labels: Record<string, string> = { draft: '草稿', pending: '待确认', confirmed: '已确认', paid: '已支付', cancelled: '已取消' }
        return csv(['账单号', '客户ID', '月份', '总金额', '状态', '明细行数'], rows.map(r => [r.billingNo, Number(r.customerId), r.billingMonth || '', r.totalAmount, labels[r.status] || '状态待核对', r.items.length]))
      }
      default: throw new BadRequestException('暂不支持该模块异步导出，请返回原业务页面导出')
    }
  }
}
