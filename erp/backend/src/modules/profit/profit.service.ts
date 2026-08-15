import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'

@Injectable()
export class ProfitService {
  constructor(private prisma: PrismaService) {}

  async summary(q: { month?: string }) {
    const where: any = {}
    if (q.month) where.analysisMonth = q.month
    const agg = await this.prisma.profitAnalysis.aggregate({
      where,
      _sum: { salesAmount: true, totalCost: true, grossProfit: true, salesQty: true },
    })
    const salesAmount = Number(agg._sum.salesAmount ?? 0)
    const grossProfit = Number(agg._sum.grossProfit ?? 0)
    return {
      salesAmount,
      totalCost: Number(agg._sum.totalCost ?? 0),
      grossProfit,
      salesQty: agg._sum.salesQty ?? 0,
      profitRate: salesAmount ? Number(((grossProfit / salesAmount) * 100).toFixed(2)) : 0,
    }
  }

  async detail(q: { month?: string }) {
    const where: any = {}
    if (q.month) where.analysisMonth = q.month
    return this.prisma.profitAnalysis.findMany({ where, orderBy: { grossProfit: 'desc' }, take: 100 })
  }
}
