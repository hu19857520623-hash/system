import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { MAX_IMPORT_FAILURE_DETAILS, type ImportRowFailure, type ImportRowResult } from '../../common/import-row-result.util'
import { SUPPLIER_IMPORT_MAX_ROWS, parseSupplierImportCsv } from './supplier-import.util'

type SupplierWrite = {
  supplierCode?: string
  supplierName?: string
  companyName?: string
  contactName?: string
  contactPhone?: string
  email?: string
  address?: string
  city?: string
  country?: string
  paymentTerms?: string
  leadTimeDays?: number | string | null
  remark?: string
}

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async list(q: PaginationDto) {
    const { page, pageSize } = getPagination(q)
    const where: any = {}
    if (q.keyword) {
      where.OR = [
        { supplierCode: { contains: q.keyword } },
        { supplierName: { contains: q.keyword } },
        { companyName: { contains: q.keyword } },
        { contactName: { contains: q.keyword } },
        { address: { contains: q.keyword } },
      ]
    }
    const [items, total] = await Promise.all([
      this.prisma.supplier.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { id: 'desc' } }),
      this.prisma.supplier.count({ where }),
    ])
    return { items, total, page, pageSize }
  }

  async detail(id: number) {
    const row = await this.prisma.supplier.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('供应商不存在')
    return row
  }

  async create(data: SupplierWrite) {
    const payload = await this.normalize(data)
    if (!payload.supplierCode) throw new BadRequestException('请填写供应商代码')
    await this.assertAvailable(payload.supplierName, payload.supplierCode)
    return this.prisma.supplier.create({ data: { ...payload, supplierCode: payload.supplierCode } })
  }

  async update(id: number, data: SupplierWrite) {
    await this.detail(id)
    const payload = await this.normalize(data, { existing: true })
    await this.assertAvailable(payload.supplierName, payload.supplierCode, id)
    return this.prisma.supplier.update({ where: { id: BigInt(id) }, data: payload })
  }

  async importFromCsv(content: string): Promise<ImportRowResult> {
    let parsed: ReturnType<typeof parseSupplierImportCsv>
    try {
      parsed = parseSupplierImportCsv(content)
    } catch (error: any) {
      throw new BadRequestException(error?.message || '导入文件格式错误')
    }
    const totalRows = parsed.rows.length + parsed.failureCount
    if (!totalRows) throw new BadRequestException('文件为空或没有有效数据行')
    if (totalRows > SUPPLIER_IMPORT_MAX_ROWS) throw new BadRequestException(`单次最多导入 ${SUPPLIER_IMPORT_MAX_ROWS} 行`)

    let imported = 0
    let failed = parsed.failureCount
    const failures: ImportRowFailure[] = [...parsed.failures]
    for (const row of parsed.rows) {
      try {
        await this.create(row)
        imported++
      } catch (error: any) {
        failed++
        if (failures.length < MAX_IMPORT_FAILURE_DETAILS) {
          failures.push({ lineNo: row.lineNo, reason: error?.message || '写入失败' })
        }
      }
    }
    return { imported, failed, failures }
  }

  private async normalize(data: SupplierWrite, options?: { existing?: boolean }) {
    const supplierName = String(data.supplierName || '').trim()
    const contactName = String(data.contactName || '').trim()
    const contactPhone = String(data.contactPhone || '').trim()
    const paymentTerms = String(data.paymentTerms || '').trim() || '现结'
    if (!supplierName) throw new BadRequestException('请填写供应商名称')
    if (supplierName.length > 200) throw new BadRequestException('供应商名称不能超过 200 字')
    if (!contactName) throw new BadRequestException('请填写联系人')
    if (contactName.length > 50) throw new BadRequestException('联系人不能超过 50 字')
    if (!contactPhone) throw new BadRequestException('请填写电话')
    if (contactPhone.length > 30) throw new BadRequestException('电话不能超过 30 字')
    if (paymentTerms.length > 100) throw new BadRequestException('结算方式不能超过 100 字')
    const supplierCode = String(data.supplierCode || '').trim()
    if (supplierCode && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$/.test(supplierCode)) {
      throw new BadRequestException('供应商代码仅支持字母、数字、下划线和短横线，最长 30 位')
    }
    const leadRaw = data.leadTimeDays
    let leadTimeDays: number | null = null
    if (leadRaw != null && leadRaw !== '') {
      const days = Number(leadRaw)
      if (!Number.isSafeInteger(days) || days < 0 || days > 9999) throw new BadRequestException('账期天数须为 0 至 9999 的整数')
      leadTimeDays = days
    }
    const email = this.optionalText(data.email, 100, '邮箱')
    if (email && !email.includes('@')) throw new BadRequestException('邮箱格式无效')
    const record = {
      supplierCode: supplierCode || undefined,
      supplierName,
      companyName: this.optionalText(data.companyName, 200, '公司名称'),
      contactName,
      contactPhone,
      email,
      address: this.optionalText(data.address, 500, '地址'),
      city: this.optionalText(data.city, 50, '城市'),
      country: this.optionalText(data.country, 50, '国家') || 'China',
      paymentTerms,
      leadTimeDays,
      remark: this.optionalText(data.remark, 2000, '备注'),
    }
    if (!options?.existing && !record.supplierCode) record.supplierCode = await this.nextSupplierCode()
    return record
  }

  private optionalText(value: unknown, max: number, label: string) {
    const text = String(value || '').trim()
    if (!text) return null
    if (text.length > max) throw new BadRequestException(`${label}不能超过 ${max} 字`)
    return text
  }

  private async nextSupplierCode() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const supplierCode = `SUP-${Date.now().toString(36)}${attempt}`.toUpperCase().slice(0, 30)
      const existing = await this.prisma.supplier.findUnique({ where: { supplierCode } })
      if (!existing) return supplierCode
    }
    throw new BadRequestException('供应商代码生成失败，请手工填写供应商代码')
  }

  private async assertAvailable(supplierName: string, supplierCode?: string | null, exceptId?: number) {
    const sameName = await this.prisma.supplier.findFirst({ where: { supplierName }, orderBy: { id: 'asc' } })
    if (sameName && Number(sameName.id) !== exceptId) throw new BadRequestException('供应商名称已存在')
    if (!supplierCode) return
    const sameCode = await this.prisma.supplier.findUnique({ where: { supplierCode } })
    if (sameCode && Number(sameCode.id) !== exceptId) throw new BadRequestException('供应商代码已存在')
  }

  async remove(id: number) {
    await this.detail(id)
    const supplierId = BigInt(id)
    const [productCount, purchaseOrderCount, prePurchaseCount, freightBillCount] = await Promise.all([
      this.prisma.product.count({ where: { supplierId } }),
      this.prisma.purchaseOrder.count({ where: { supplierId } }),
      this.prisma.prePurchaseOrder.count({ where: { supplierId } }),
      this.prisma.supplierFreightBill.count({ where: { supplierId } }),
    ])
    if (productCount || purchaseOrderCount || prePurchaseCount || freightBillCount) {
      const references = [
        productCount && `${productCount} 个商品`,
        purchaseOrderCount && `${purchaseOrderCount} 张采购单`,
        prePurchaseCount && `${prePurchaseCount} 条预采购`,
        freightBillCount && `${freightBillCount} 张运费账单`,
      ].filter(Boolean).join('、')
      throw new BadRequestException(`供应商仍关联${references}，不能删除`)
    }
    await this.prisma.supplier.delete({ where: { id: BigInt(id) } })
    return { id }
  }
}
