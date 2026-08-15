import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'

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
        { contactName: { contains: q.keyword } },
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

  async create(data: any) {
    if (!data.supplierCode) data.supplierCode = 'SUP-' + Date.now().toString().slice(-6)
    if (!data.paymentTerms) data.paymentTerms = '现结'
    return this.prisma.supplier.create({ data })
  }

  async update(id: number, data: any) {
    await this.detail(id)
    return this.prisma.supplier.update({ where: { id: BigInt(id) }, data })
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
