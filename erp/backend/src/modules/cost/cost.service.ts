import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'

@Injectable()
export class CostService {
  constructor(private prisma: PrismaService) {}

  async list(q: PaginationDto & { costType?: string; startDate?: string; endDate?: string; minAmount?: string; maxAmount?: string }) {
    const { page, pageSize } = getPagination(q)
    const where: any = {}
    if (q.costType) where.costType = q.costType
    if (q.keyword) {
      where.OR = [{ costNo: { contains: q.keyword } }, { sku: { contains: q.keyword } }, { referenceNo: { contains: q.keyword } }]
    }
    const startDate = q.startDate ? new Date(q.startDate) : null
    const endDate = q.endDate ? new Date(q.endDate) : null
    if (startDate && !Number.isNaN(startDate.getTime())) where.costDate = { ...(where.costDate || {}), gte: startDate }
    if (endDate && !Number.isNaN(endDate.getTime())) {
      endDate.setHours(23, 59, 59, 999)
      where.costDate = { ...(where.costDate || {}), lte: endDate }
    }
    const minAmount = q.minAmount == null || q.minAmount === '' ? null : Number(q.minAmount)
    const maxAmount = q.maxAmount == null || q.maxAmount === '' ? null : Number(q.maxAmount)
    if (minAmount != null && Number.isFinite(minAmount)) where.amountRmb = { ...(where.amountRmb || {}), gte: minAmount }
    if (maxAmount != null && Number.isFinite(maxAmount)) where.amountRmb = { ...(where.amountRmb || {}), lte: maxAmount }
    const [items, total] = await Promise.all([
      this.prisma.costLedger.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { id: 'desc' } }),
      this.prisma.costLedger.count({ where }),
    ])
    return { items, total, page, pageSize }
  }

  create(data: any, createdBy?: number) {
    return this.prisma.costLedger.create({
      data: {
        costNo: data.costNo || 'COST-' + Date.now().toString().slice(-8),
        productId: data.productId ? BigInt(data.productId) : undefined,
        sku: data.sku,
        costType: data.costType,
        amountRmb: data.amountRmb,
        amountZar: data.amountZar,
        exchangeRate: data.exchangeRate,
        referenceNo: data.referenceNo,
        costDate: data.costDate ? new Date(data.costDate) : new Date(),
        remark: data.remark,
        createdBy: createdBy ? BigInt(createdBy) : undefined,
      },
    })
  }
}
