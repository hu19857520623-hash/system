import { BadRequestException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { PRODUCT_DIM_SELECT } from '../management-loop/management-loop-report.util'
import {
  allocateFreightArea,
  parseCargoItems,
  readStoredSkuDetails,
  type FreightSkuDetails,
} from './freight-bill.util'

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0]

@Injectable()
export class FreightBillService {
  constructor(private prisma: PrismaService) {}

  async list(q: PaginationDto & { status?: string }) {
    const { page, pageSize } = getPagination(q)
    const where: Prisma.SupplierFreightBillWhereInput = { source: { not: 'finance_approve' } }
    if (q.status) where.status = q.status
    if (q.keyword) {
      where.OR = [
        { billNo: { contains: q.keyword } },
        { containerNo: { contains: q.keyword } },
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
    const skuByContainer = await this.resolveSkuDetailsForContainers(
      items
        .filter((row) => !readStoredSkuDetails(row.skuDetails) && row.containerNo)
        .map((row) => String(row.containerNo)),
    )

    return {
      items: items.map((row) => {
        const supplier = supMap.get(Number(row.supplierId))
        const stored = readStoredSkuDetails(row.skuDetails)
        const skuDetails = stored || (row.containerNo ? skuByContainer.get(this.normalizeContainerNo(row.containerNo)) : null) || {
          items: [],
          totalAreaCbm: 0,
        }
        return {
          ...this.serializeBill(row, supplier?.supplierName || supplier?.supplierCode || '', skuDetails),
        }
      }),
      total,
      page,
      pageSize,
    }
  }

  async containerOptions() {
    const shipments = await this.prisma.mingruiShipment.findMany({
      where: {
        AND: [
          { containerNo: { not: null } },
          { containerNo: { not: '' } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 300,
      select: {
        shipmentNo: true,
        containerNo: true,
        mode: true,
        cargoItems: true,
        poNos: true,
      },
    })
    const unique = new Map<string, (typeof shipments)[number]>()
    for (const row of shipments) {
      const containerNo = this.normalizeContainerNo(row.containerNo)
      if (!containerNo || unique.has(containerNo)) continue
      unique.set(containerNo, row)
    }
    const skuByContainer = await this.resolveSkuDetailsForContainers([...unique.keys()])
    return [...unique.entries()].map(([containerNo, row]) => {
      const skuDetails = skuByContainer.get(containerNo) || { items: [], totalAreaCbm: 0 }
      return {
        containerNo,
        shipmentNo: row.shipmentNo,
        mode: row.mode,
        poNos: row.poNos || '',
        skuCount: skuDetails.items.length,
        totalAreaCbm: skuDetails.totalAreaCbm,
        skuLines: skuDetails.items,
      }
    })
  }

  async create(data: {
    supplierId?: number
    billMonth?: string
    totalAmount?: number
    containerCount?: number
    containerNo?: string
    remark?: string
    status?: string
    source?: string
    poId?: number
    poNo?: string
    weightKg?: number
    billNo?: string
  }) {
    const containerNo = this.normalizeContainerNo(data.containerNo)
    if (!containerNo) {
      throw new BadRequestException('请填写关联柜号')
    }
    const skuDetails = await this.buildSkuDetails(containerNo)
    const row = await this.prisma.supplierFreightBill.create({
      data: {
        billNo: data.billNo || 'SE-' + Date.now().toString().slice(-8),
        supplierId: BigInt(data.supplierId ?? 0),
        poId: data.poId != null ? BigInt(data.poId) : undefined,
        poNo: data.poNo || undefined,
        source: data.source || 'manual',
        billMonth: data.billMonth || '',
        totalAmount: data.totalAmount ?? 0,
        containerCount: data.containerCount ?? 0,
        containerNo,
        skuDetails: skuDetails as unknown as Prisma.InputJsonValue,
        weightKg: data.weightKg,
        status: data.status || 'draft',
        remark: data.remark,
      },
    })
    return this.serializeBill(row, '', skuDetails)
  }

  /** @deprecated 采购成本已改由成本台账记录，海运账单页仅展示手工录入的海运费用 */
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

  private serializeBill(
    row: {
      id: bigint
      billNo: string
      supplierId: bigint
      poId: bigint | null
      poNo: string | null
      source: string
      billMonth: string
      totalAmount: Prisma.Decimal | number
      containerCount: number | null
      containerNo?: string | null
      weightKg: Prisma.Decimal | number | null
      status: string
      remark: string | null
      createdAt: Date
      updatedAt: Date
    },
    supplierName: string,
    skuDetails: FreightSkuDetails,
  ) {
    return {
      id: Number(row.id),
      billNo: row.billNo,
      supplierId: Number(row.supplierId),
      poId: row.poId != null ? Number(row.poId) : null,
      poNo: row.poNo,
      source: row.source,
      billMonth: row.billMonth,
      totalAmount: Number(row.totalAmount),
      containerCount: row.containerCount ?? 0,
      containerNo: row.containerNo || '',
      weightKg: row.weightKg != null ? Number(row.weightKg) : null,
      status: row.status,
      remark: row.remark,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      supplierName,
      skuLines: skuDetails.items,
      totalAreaCbm: skuDetails.totalAreaCbm,
    }
  }

  private normalizeContainerNo(value: unknown) {
    return String(value || '').trim().toUpperCase()
  }

  private async buildSkuDetails(containerNo: string): Promise<FreightSkuDetails> {
    const map = await this.resolveSkuDetailsForContainers([containerNo])
    return map.get(this.normalizeContainerNo(containerNo)) || { items: [], totalAreaCbm: 0 }
  }

  private async resolveSkuDetailsForContainers(containerNos: string[]) {
    const result = new Map<string, FreightSkuDetails>()
    const unique = [...new Set(containerNos.map((no) => this.normalizeContainerNo(no)).filter(Boolean))]
    if (!unique.length) return result

    const shipments = await this.prisma.mingruiShipment.findMany({
      where: { OR: unique.map((containerNo) => ({ containerNo })) },
      orderBy: { updatedAt: 'desc' },
      select: { containerNo: true, cargoItems: true },
    })
    const cargoByContainer = new Map<string, ReturnType<typeof parseCargoItems>>()
    for (const row of shipments) {
      const containerNo = this.normalizeContainerNo(row.containerNo)
      if (!containerNo || cargoByContainer.has(containerNo)) continue
      cargoByContainer.set(containerNo, parseCargoItems(row.cargoItems))
    }

    const skus = [...new Set([...cargoByContainer.values()].flat().map((item) => item.sku))]
    const products = skus.length
      ? await this.prisma.product.findMany({
          where: { sku: { in: skus } },
          select: { ...PRODUCT_DIM_SELECT, sku: true, productName: true },
        })
      : []
    const productMap = new Map(products.map((p) => [p.sku, p]))

    for (const containerNo of unique) {
      result.set(containerNo, allocateFreightArea(cargoByContainer.get(containerNo) || [], productMap))
    }
    return result
  }
}
