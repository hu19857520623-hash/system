import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { OperationLogService } from '../operation-log/operation-log.service'
import { PrePurchaseService } from '../purchase/pre-purchase.service'

@Injectable()
export class ProductDevService {
  constructor(
    private prisma: PrismaService,
    private opLog: OperationLogService,
    private prePurchase: PrePurchaseService,
  ) {}

  buildSku(id: number, custom?: string) {
    const trimmed = custom?.trim()
    if (trimmed) return trimmed
    return `TK-${String(id).padStart(5, '0')}`
  }

  private dec(v: unknown) {
    if (v === null || v === undefined || v === '') return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }

  private str(v: unknown) {
    if (v === null || v === undefined) return undefined
    const s = String(v).trim()
    return s || undefined
  }

  /** 根据包装尺寸计算 CBM 与体积重（海运按 167 kg/m³） */
  calcVolumeMetrics(lengthCm?: number | null, widthCm?: number | null, heightCm?: number | null) {
    if (!lengthCm || !widthCm || !heightCm) return { cbm: undefined, volumetricWeightKg: undefined }
    const cbm = (lengthCm * widthCm * heightCm) / 1_000_000
    return {
      cbm: Math.round(cbm * 1_000_000) / 1_000_000,
      volumetricWeightKg: Math.round(cbm * 167 * 1000) / 1000,
    }
  }

  private mapDevFields(data: any) {
    const pkgLen = this.dec(data.packageLengthCm)
    const pkgWid = this.dec(data.packageWidthCm)
    const pkgHei = this.dec(data.packageHeightCm)
    const autoMetrics = this.calcVolumeMetrics(pkgLen, pkgWid, pkgHei)
    const cbm = this.dec(data.cbm) ?? autoMetrics.cbm
    const volumetricWeightKg = this.dec(data.volumetricWeightKg) ?? autoMetrics.volumetricWeightKg

    return {
      productName: this.str(data.productName),
      takealotUrl: this.str(data.takealotUrl),
      takealotPriceImageUrl: this.str(data.takealotPriceImageUrl),
      amazonUrl: this.str(data.amazonUrl),
      alibaba1688Url: this.str(data.alibaba1688Url),
      alibaba1688ImageUrl: this.str(data.alibaba1688ImageUrl),
      spec: this.str(data.spec),
      productLengthCm: this.dec(data.productLengthCm),
      productWidthCm: this.dec(data.productWidthCm),
      productHeightCm: this.dec(data.productHeightCm),
      packageLengthCm: pkgLen,
      packageWidthCm: pkgWid,
      packageHeightCm: pkgHei,
      estimatedCost: this.dec(data.estimatedCost),
      marketPrice: this.dec(data.marketPrice),
      sellPriceRmb: this.dec(data.sellPriceRmb),
      maxSellPriceRmb: this.dec(data.maxSellPriceRmb),
      seaFreightChannel: this.str(data.seaFreightChannel),
      volumetricWeightKg,
      cbm,
      reason: this.str(data.reason),
      status: data.status,
    }
  }

  async list(q: PaginationDto & { status?: string }) {
    const { page, pageSize } = getPagination(q)
    const where: any = {}
    if (q.status) where.status = q.status
    if (q.keyword) {
      where.OR = [{ applyNo: { contains: q.keyword } }, { productName: { contains: q.keyword } }, { sku: { contains: q.keyword } }]
    }
    const [items, total] = await Promise.all([
      this.prisma.productDev.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { id: 'desc' } }),
      this.prisma.productDev.count({ where }),
    ])
    const applicantIds = [...new Set(items.map((r) => r.applicantId).filter(Boolean))] as bigint[]
    const users = applicantIds.length
      ? await this.prisma.sysUser.findMany({
          where: { id: { in: applicantIds } },
          select: { id: true, realName: true, username: true },
        })
      : []
    const nameMap = new Map(users.map((u) => [Number(u.id), u.realName || u.username]))
    const enriched = items.map((r) => ({
      ...r,
      applicantName: r.applicantId ? nameMap.get(Number(r.applicantId)) ?? null : null,
    }))
    return { items: enriched, total, page, pageSize }
  }

  async detail(id: number) {
    const row = await this.prisma.productDev.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('选品申请不存在')
    return row
  }

  async validateSku(sku?: string, excludeDevId?: number) {
    const trimmed = sku?.trim()
    if (!trimmed) return undefined
    const where: any = { sku: trimmed }
    if (excludeDevId) where.id = { not: BigInt(excludeDevId) }
    const [inDev, inProduct] = await Promise.all([
      this.prisma.productDev.findFirst({ where }),
      this.prisma.product.findUnique({ where: { sku: trimmed } }),
    ])
    if (inDev || inProduct) throw new BadRequestException(`重复 SKU：${trimmed}`)
    return trimmed
  }

  async create(data: any, applicantId?: number) {
    if (!this.str(data.productName)) throw new BadRequestException('请填写商品名称')
    const sku = data.sku ? await this.validateSku(data.sku) : undefined
    const fields = this.mapDevFields(data)
    const row = await this.prisma.productDev.create({
      data: {
        applyNo: 'PD-' + Date.now().toString().slice(-8),
        sku,
        ...fields,
        productName: this.str(data.productName)!,
        status: fields.status || 'draft',
        applicantId: applicantId ? BigInt(applicantId) : undefined,
      },
    })
    await this.opLog.log({
      operatorId: applicantId,
      module: 'product_audit',
      action: 'create',
      targetType: 'product_dev',
      targetId: row.applyNo,
      detail: { productName: row.productName },
    })
    return row
  }

  private devFieldKeys = [
    'productName', 'takealotUrl', 'takealotPriceImageUrl', 'amazonUrl', 'alibaba1688Url', 'alibaba1688ImageUrl',
    'spec', 'productLengthCm', 'productWidthCm', 'productHeightCm', 'packageLengthCm', 'packageWidthCm', 'packageHeightCm',
    'estimatedCost', 'marketPrice', 'sellPriceRmb', 'maxSellPriceRmb', 'seaFreightChannel', 'volumetricWeightKg', 'cbm', 'reason',
  ]

  async update(id: number, data: any, operatorId?: number) {
    const before = await this.detail(id)
    const updateData: any = {}
    const hasDevFields = this.devFieldKeys.some((k) => k in data)

    if (hasDevFields) {
      Object.assign(updateData, this.mapDevFields(data))
      delete updateData.status
    }
    if ('status' in data) updateData.status = data.status

    if ('sku' in data && (before.status === 'draft' || before.status === 'rejected')) {
      updateData.sku = data.sku ? await this.validateSku(data.sku, id) : null
    }

    const row = await this.prisma.productDev.update({ where: { id: BigInt(id) }, data: updateData })
    await this.opLog.log({
      operatorId,
      module: 'product_audit',
      action: 'update',
      targetType: 'product_dev',
      targetId: before.applyNo,
      detail: { productName: row.productName, status: row.status },
    })
    return row
  }

  async submit(id: number, operatorId?: number) {
    const row = await this.detail(id)
    if (row.status !== 'draft' && row.status !== 'rejected') {
      throw new BadRequestException('仅草稿或已驳回状态可提交审核')
    }
    const updated = await this.prisma.productDev.update({ where: { id: BigInt(id) }, data: { status: 'submitted' } })
    await this.opLog.log({
      operatorId,
      module: 'product_audit',
      action: 'submit',
      targetType: 'product_dev',
      targetId: row.applyNo,
      detail: { productName: row.productName },
    })
    return updated
  }

  async approve(id: number, auditorId?: number, remark?: string, purchaseQty?: number) {
    const row = await this.detail(id)
    if (row.status !== 'submitted') throw new BadRequestException('仅待审核状态可通过')
    if (!purchaseQty || purchaseQty <= 0) throw new BadRequestException('请核定采购数量')

    const finalSku = this.buildSku(Number(row.id), row.sku ?? undefined)
    await this.validateSku(finalSku, id)

    const updated = await this.prisma.productDev.update({
      where: { id: BigInt(id) },
      data: {
        status: 'approved',
        sku: finalSku,
        auditorId: auditorId ? BigInt(auditorId) : undefined,
        auditRemark: remark,
        purchaseQty,
        auditedAt: new Date(),
      },
    })

    return Promise.resolve(updated).then(async (updated) => {
      await this.prePurchase.createFromDev({
        id: BigInt(id),
        applyNo: row.applyNo,
        productName: row.productName,
        spec: row.spec,
        sku: finalSku,
        purchaseQty,
        estimatedCost: row.estimatedCost,
      })
      await this.opLog.log({
        operatorId: auditorId,
        module: 'product_audit',
        action: 'approve',
        targetType: 'product_dev',
        targetId: row.applyNo,
        detail: { sku: finalSku, purchaseQty, remark },
      })
      return updated
    })
  }

  async reject(id: number, auditorId?: number, remark?: string) {
    const row = await this.detail(id)
    if (row.status !== 'submitted') throw new BadRequestException('仅待审核状态可驳回')
    const updated = await this.prisma.productDev.update({
      where: { id: BigInt(id) },
      data: { status: 'rejected', auditorId: auditorId ? BigInt(auditorId) : undefined, auditRemark: remark, auditedAt: new Date() },
    })
    await this.opLog.log({
      operatorId: auditorId,
      module: 'product_audit',
      action: 'reject',
      targetType: 'product_dev',
      targetId: row.applyNo,
      detail: { remark },
    })
    return updated
  }

  async remove(id: number, operatorId?: number) {
    const row = await this.detail(id)
    await this.prisma.productDev.delete({ where: { id: BigInt(id) } })
    await this.opLog.log({
      operatorId,
      module: 'product_audit',
      action: 'delete',
      targetType: 'product_dev',
      targetId: row.applyNo,
    })
    return { id }
  }
}
