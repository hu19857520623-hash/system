import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0]

@Injectable()
export class FreightBillService {
  constructor(private prisma: PrismaService) {}

  async list(q: PaginationDto & { status?: string }) {
    const { page, pageSize } = getPagination(q)
    const where: any = {}
    if (q.status) where.status = q.status
    if (q.keyword) {
      where.OR = [
        { billNo: { contains: q.keyword } },
        { poNo: { contains: q.keyword } },
        { remark: { contains: q.keyword } },
      ]
    }
    const [items, total] = await Promise.all([
      this.prisma.supplierFreightBill.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'desc' },
      }),
      this.prisma.supplierFreightBill.count({ where }),
    ])

    const supplierIds = [...new Set(items.map((i) => Number(i.supplierId)).filter(Boolean))]
    const suppliers = supplierIds.length
      ? await this.prisma.supplier.findMany({
          where: { id: { in: supplierIds.map((id) => BigInt(id)) } },
          select: { id: true, supplierName: true, supplierCode: true },
        })
      : []
    const supMap = new Map(suppliers.map((s) => [Number(s.id), s]))

    return {
      items: items.map((row) => {
        const supplier = supMap.get(Number(row.supplierId))
        return {
          ...row,
          id: Number(row.id),
          supplierId: Number(row.supplierId),
          poId: row.poId != null ? Number(row.poId) : null,
          totalAmount: Number(row.totalAmount),
          weightKg: row.weightKg != null ? Number(row.weightKg) : null,
          supplierName: supplier?.supplierName || supplier?.supplierCode || '',
        }
      }),
      total,
      page,
      pageSize,
    }
  }

  create(data: any) {
    return this.prisma.supplierFreightBill.create({
      data: {
        billNo: data.billNo || 'SE-' + Date.now().toString().slice(-8),
        supplierId: BigInt(data.supplierId ?? 0),
        poId: data.poId != null ? BigInt(data.poId) : undefined,
        poNo: data.poNo || undefined,
        source: data.source || 'manual',
        billMonth: data.billMonth,
        totalAmount: data.totalAmount ?? 0,
        containerCount: data.containerCount ?? 0,
        weightKg: data.weightKg,
        status: data.status || 'draft',
        remark: data.remark,
      },
    })
  }

  /** 财务审核采购单通过后，将采购单全部成本记入供应商海运账单（幂等：同一 PO 不重复建账，已存在则更新金额） */
  async recordFromFinanceApproval(
    tx: Tx,
    input: {
      poId: bigint
      poNo: string
      supplierId: bigint
      totalAmount: number
      costRemark?: string
      financeAt?: Date | null
    },
  ) {
    const totalAmount = Math.round(input.totalAmount * 100) / 100
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) return null

    const at = input.financeAt || new Date()
    const billMonth = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`
    const remark = input.costRemark || `采购单 ${input.poNo} 成本汇总（财务审核自动生成）`

    const existing = await tx.supplierFreightBill.findUnique({ where: { poId: input.poId } })
    if (existing) {
      if (existing.source === 'finance_approve') {
        return tx.supplierFreightBill.update({
          where: { poId: input.poId },
          data: { totalAmount, remark, billMonth },
        })
      }
      return existing
    }

    return tx.supplierFreightBill.create({
      data: {
        billNo: `SE-PO-${input.poNo}`,
        supplierId: input.supplierId,
        poId: input.poId,
        poNo: input.poNo,
        source: 'finance_approve',
        billMonth,
        totalAmount,
        containerCount: 0,
        status: 'draft',
        remark,
      },
    })
  }
}
