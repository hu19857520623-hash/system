import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { OperationLogService } from '../operation-log/operation-log.service'
import { BillingService } from '../billing/billing.service'
import { notifyOms } from '../../common/oms-notify.util'
import { FileStoreService } from '../../common/file-store.service'
import {
  RETURN_STATUS_LABELS,
  RETURN_RE_RECEIVE_STATUSES,
  RETURN_FEE_RATES,
  isValidProcessMethod,
  isValidReturnWarehouse,
  isValidInspectionResult,
  processMethodLabel,
  inspectionResultLabel,
  CUSTOMER_DECISION_LABELS,
  RETURN_WAREHOUSES,
  normalizeReturnWarehouse,
  type ReturnProcessMethod,
} from './return.constants'
import {
  computeCartonMeasures,
  sumCartonTotals,
  type CartonInput,
} from './return-measure.util'
import {
  ALL_RETURN_CHARGE_TYPES,
  RETURN_AUTO_CHARGE_TYPES,
  RETURN_DECISION_CHARGE_TYPES,
  RETURN_MANUAL_CHARGE_TYPES,
  buildDiscardFeeLines,
  buildKeepFeeLines,
} from './return-decision-fee.util'
import { buildMeasurePhaseFeeLines, buildFeePreviewContext, defaultMeasureFeeRules, mapDbTemplateRules, normalizeExtraFeeLines, normalizeTemplateRulesInput, type FeeTemplateRule } from './return-fee-template.util'

function round2Amount(n: number) {
  return Math.round(n * 100) / 100
}

export type OmsCreateReturnInput = {
  returnNo?: string
  customerCode: string
  orderNo: string
  referenceNo?: string
  trackingNo?: string
  sellerStoreName?: string
  sellerTaxNo?: string
  returnWarehouse?: string
  expectedArrivalAt?: string
  returnReason: string
  returnDescription?: string
  requestedProcess: string
  remark?: string
  items: { sku: string; quantity: number; productName?: string }[]
  attachments?: { fileType?: string; fileName: string; contentBase64?: string; url?: string }[]
}

@Injectable()
export class ReturnsService {
  constructor(
    private prisma: PrismaService,
    private opLog: OperationLogService,
    private files: FileStoreService,
    private billing: BillingService,
  ) {}

  private writeAttachment(fileName: string, contentBase64: string) {
    const buf = Buffer.from(contentBase64, 'base64')
    const { relativePath } = this.files.write('return-attachments', `${Date.now()}_${fileName}`, buf)
    return { fileName, filePath: relativePath }
  }

  private mapAttachments(rows: { id: bigint; fileType: string; fileName: string; createdAt: Date }[]) {
    return (rows || []).map((a) => ({
      id: Number(a.id),
      fileType: a.fileType,
      fileName: a.fileName,
      createdAt: a.createdAt,
    }))
  }

  private normalizeAttachments(
    attachments?: { fileType?: string; fileName: string; contentBase64?: string; url?: string }[],
  ) {
    if (!Array.isArray(attachments)) return []
    return attachments
      .map((a) => {
        let contentBase64 = a.contentBase64 || ''
        if (!contentBase64 && a.url?.startsWith('data:')) {
          contentBase64 = a.url.split(',')[1] || ''
        }
        return {
          fileType: (a.fileType || 'return_doc').trim(),
          fileName: String(a.fileName || '').trim(),
          contentBase64,
        }
      })
      .filter((a) => a.fileName && a.contentBase64)
  }

  private async persistAttachments(
    tx: any,
    returnId: bigint,
    attachments: { fileType?: string; fileName: string; contentBase64?: string; url?: string }[],
  ) {
    const normalized = this.normalizeAttachments(attachments)
    for (const att of normalized) {
      const saved = this.writeAttachment(att.fileName, att.contentBase64)
      await tx.returnAttachment.create({
        data: {
          returnId,
          fileType: att.fileType || 'return_doc',
          fileName: saved.fileName,
          filePath: saved.filePath,
        },
      })
    }
  }

  async list(
    q: PaginationDto & {
      status?: string
      keyword?: string
      customerCode?: string
      returnWarehouse?: string
      requestedProcess?: string
      processResult?: string
      returnReason?: string
      sku?: string
      returnNo?: string
      orderNo?: string
      trackingNo?: string
      sellerTaxNo?: string
      referenceNo?: string
      createdFrom?: string
      createdTo?: string
      expectedArrivalFrom?: string
      expectedArrivalTo?: string
      receivedFrom?: string
      receivedTo?: string
      processedFrom?: string
      processedTo?: string
    },
  ) {
    const { page, pageSize } = getPagination(q)
    const where: Record<string, unknown> = {}
    if (q.status?.trim()) where.status = q.status.trim()
    if (q.customerCode?.trim()) where.omsCustomerCode = { contains: q.customerCode.trim() }
    if (q.returnWarehouse?.trim()) where.returnWarehouse = q.returnWarehouse.trim()
    if (q.requestedProcess?.trim()) where.requestedProcess = q.requestedProcess.trim()
    if (q.processResult?.trim()) where.processResult = q.processResult.trim()
    if (q.returnReason?.trim()) where.returnReason = { contains: q.returnReason.trim() }
    if (q.returnNo?.trim()) where.returnNo = { contains: q.returnNo.trim() }
    if (q.orderNo?.trim()) where.orderNo = { contains: q.orderNo.trim() }
    if (q.trackingNo?.trim()) where.trackingNo = { contains: q.trackingNo.trim() }
    if (q.sellerTaxNo?.trim()) where.sellerTaxNo = { contains: q.sellerTaxNo.trim() }
    if (q.referenceNo?.trim()) where.referenceNo = { contains: q.referenceNo.trim() }

    this.applyDateRange(where, 'createdAt', q.createdFrom, q.createdTo)
    this.applyDateRange(where, 'expectedArrivalAt', q.expectedArrivalFrom, q.expectedArrivalTo)
    this.applyDateRange(where, 'receivedAt', q.receivedFrom, q.receivedTo)
    this.applyDateRange(where, 'processedAt', q.processedFrom, q.processedTo)

    const sku = q.sku?.trim()
    if (sku) {
      where.items = { some: { OR: [{ sku: { contains: sku } }, { productName: { contains: sku } }] } }
    }

    if (q.keyword?.trim()) {
      const kw = q.keyword.trim()
      where.OR = [
        { returnNo: { contains: kw } },
        { orderNo: { contains: kw } },
        { referenceNo: { contains: kw } },
        { trackingNo: { contains: kw } },
        { sellerStoreName: { contains: kw } },
        { sellerTaxNo: { contains: kw } },
        { returnReason: { contains: kw } },
        { returnDescription: { contains: kw } },
        { returnWarehouse: { contains: kw } },
        { omsCustomerCode: { contains: kw } },
      ]
    }
    const [rows, total] = await Promise.all([
      this.prisma.returnOrder.findMany({
        where,
        include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'desc' },
      }),
      this.prisma.returnOrder.count({ where }),
    ])
    return {
      items: rows.map((r) => this.enrichRow(r)),
      total,
      page,
      pageSize,
    }
  }

  async detail(id: number) {
    const row = await this.prisma.returnOrder.findUnique({
      where: { id: BigInt(id) },
      include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
    })
    if (!row) throw new NotFoundException('退件单不存在')
    const enriched = this.enrichRow(row)
    const feeLines = await this.loadFeeLines(row.returnNo)
    return { ...enriched, feeLines }
  }

  async listByOmsCustomer(customerCode: string) {
    const code = customerCode.trim()
    if (!code) throw new BadRequestException('缺少客户编码')
    const rows = await this.prisma.returnOrder.findMany({
      where: { omsCustomerCode: code },
      include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
      orderBy: { id: 'desc' },
      take: 200,
    })
    return { items: rows.map((r) => this.mapReturnForOms(r)), total: rows.length }
  }

  async getByReturnNoForOms(returnNo: string) {
    const no = returnNo.trim()
    const row = await this.prisma.returnOrder.findUnique({
      where: { returnNo: no },
      include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
    })
    if (!row) throw new NotFoundException(`退件单 ${no} 不存在`)
    return this.mapReturnForOms(row)
  }

  async createFromOms(data: OmsCreateReturnInput) {
    const customerCode = String(data.customerCode || '').trim()
    if (!customerCode) throw new BadRequestException('缺少 customerCode')
    const customer = await this.prisma.customer.findUnique({ where: { customerCode } })
    if (!customer) throw new NotFoundException(`客户代码 ${customerCode} 不存在`)
    if (customer.status !== 1) throw new BadRequestException('客户已停用')

    const orderNo = String(data.orderNo || '').trim()
    if (!orderNo) throw new BadRequestException('缺少订单号')
    const returnReason = String(data.returnReason || '').trim()
    if (!returnReason) throw new BadRequestException('缺少退件原因')
    const requestedProcess = String(data.requestedProcess || '').trim()
    if (!isValidProcessMethod(requestedProcess)) {
      throw new BadRequestException('无效的处理方式')
    }
    const returnWarehouse = String(data.returnWarehouse || '').trim().toUpperCase()
    if (!isValidReturnWarehouse(returnWarehouse)) {
      throw new BadRequestException('请选择退件仓库（JHB3 / CPT2 / DBN）')
    }

    const lines = Array.isArray(data.items) ? data.items : []
    if (!lines.length) throw new BadRequestException('请填写 SKU 明细')

    const returnNo = String(data.returnNo || '').trim() || `RT-${Date.now().toString().slice(-10)}`
    const existing = await this.prisma.returnOrder.findUnique({ where: { returnNo } })
    if (existing && existing.status !== 'cancelled') {
      const detail = await this.prisma.returnOrder.findUnique({
        where: { id: existing.id },
        include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
      })
      return { ...this.mapReturnForOms(detail!), idempotent: true }
    }

    const parsedItems = lines.map((l) => {
      const sku = String(l.sku || '').trim()
      const quantity = Math.floor(Number(l.quantity ?? 0))
      if (!sku || quantity <= 0) throw new BadRequestException('SKU 与数量无效')
      return {
        sku,
        quantity,
        productName: String(l.productName || sku).slice(0, 300),
      }
    })

    let expectedArrivalAt: Date | undefined
    if (data.expectedArrivalAt?.trim()) {
      const d = new Date(data.expectedArrivalAt.trim())
      if (!Number.isNaN(d.getTime())) expectedArrivalAt = d
    }

    const returnData = {
      orderNo,
      referenceNo: data.referenceNo?.trim() || undefined,
      trackingNo: data.trackingNo?.trim() || undefined,
      sellerStoreName: data.sellerStoreName?.trim() || undefined,
      sellerTaxNo: data.sellerTaxNo?.trim() || undefined,
      returnWarehouse,
      expectedArrivalAt,
      returnReason,
      returnDescription: data.returnDescription?.trim() || undefined,
      requestedProcess,
      status: 'pending_arrival' as const,
      processResult: null,
      processRemark: null,
      receivedAt: null,
      processedAt: null,
      processedBy: null,
      remark: data.remark?.trim() || undefined,
    }

    const row = await this.prisma.$transaction(async (tx) => {
      if (existing?.status === 'cancelled') {
        if (existing.omsCustomerCode && existing.omsCustomerCode !== customerCode) {
          throw new BadRequestException('客户编码与退件单不匹配')
        }
        await tx.returnOrderItem.deleteMany({ where: { returnId: existing.id } })
        const updated = await tx.returnOrder.update({
          where: { id: existing.id },
          data: {
            ...returnData,
            omsCustomerCode: customerCode,
            items: { create: parsedItems },
          },
          include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
        })
        await this.persistAttachments(tx, existing.id, data.attachments || [])
        return tx.returnOrder.findUnique({
          where: { id: existing.id },
          include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
        }) ?? updated
      }

      const created = await tx.returnOrder.create({
        data: {
          returnNo,
          customerId: customer.id,
          omsCustomerCode: customerCode,
          ...returnData,
          items: { create: parsedItems },
        },
        include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
      })
      await this.persistAttachments(tx, created.id, data.attachments || [])
      return tx.returnOrder.findUnique({
        where: { id: created.id },
        include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
      })
    })
    if (!row) throw new NotFoundException('退件单创建失败')

    await this.opLog.log({
      module: 'returns',
      action: existing?.status === 'cancelled' ? 'oms_return_resubmit' : 'oms_return_create',
      targetType: 'return_order',
      targetId: returnNo,
      detail: { customerCode, orderNo, itemCount: parsedItems.length, reactivated: existing?.status === 'cancelled' },
    })

    void this.pushReturnStatusToOms(returnNo)
    return { ...this.mapReturnForOms(row), idempotent: false, reactivated: existing?.status === 'cancelled' }
  }

  async receive(
    id: number,
    body: { receivedQty?: number; receivedCartonCount?: number; remark?: string },
    userId: number,
  ) {
    const row = await this.prisma.returnOrder.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('退件单不存在')
    if (row.status !== 'pending_arrival') {
      throw new BadRequestException('当前状态不可收货，仅「在途」可收货')
    }
    const expectedQty = await this.prisma.returnOrderItem.aggregate({
      where: { returnId: row.id },
      _sum: { quantity: true },
    })
    const receivedQty = body.receivedQty != null
      ? Math.floor(Number(body.receivedQty))
      : expectedQty._sum.quantity || 0
    const receivedCartonCount = body.receivedCartonCount != null
      ? Math.floor(Number(body.receivedCartonCount))
      : 1
    if (receivedQty <= 0) throw new BadRequestException('实收件数须大于 0')
    if (receivedCartonCount <= 0) throw new BadRequestException('实收箱数须大于 0')

    const updated = await this.prisma.returnOrder.update({
      where: { id: row.id },
      data: {
        status: 'received',
        receivedAt: new Date(),
        receivedBy: BigInt(userId),
        receivedQty,
        receivedCartonCount,
        remark: body.remark?.trim() || row.remark || undefined,
        feeStatus: row.feeStatus === 'none' ? 'none' : row.feeStatus,
      },
      include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
    })
    await this.opLog.log({
      module: 'returns',
      action: 'receive',
      targetType: 'return_order',
      targetId: row.returnNo,
      operatorId: userId,
      detail: { receivedQty, receivedCartonCount },
    })
    void this.pushReturnStatusToOms(row.returnNo)
    return this.enrichRow(updated)
  }

  async reReceive(
    id: number,
    body: { receivedQty?: number; receivedCartonCount?: number; remark?: string },
    userId: number,
  ) {
    const row = await this.prisma.returnOrder.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('退件单不存在')
    if (!(RETURN_RE_RECEIVE_STATUSES as readonly string[]).includes(row.status)) {
      throw new BadRequestException('当前状态不可重新收货，仅已收货/已测体积/已算费可修正')
    }

    const receivedQty = body.receivedQty != null
      ? Math.floor(Number(body.receivedQty))
      : row.receivedQty || 0
    const receivedCartonCount = body.receivedCartonCount != null
      ? Math.floor(Number(body.receivedCartonCount))
      : row.receivedCartonCount || 1
    if (receivedQty <= 0) throw new BadRequestException('实收件数须大于 0')
    if (receivedCartonCount <= 0) throw new BadRequestException('实收箱数须大于 0')

    await this.clearPendingReturnCharges(row.returnNo)

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.returnCartonMeasure.deleteMany({ where: { returnId: row.id } })
      return tx.returnOrder.update({
        where: { id: row.id },
        data: {
          status: 'received',
          receivedAt: new Date(),
          receivedBy: BigInt(userId),
          receivedQty,
          receivedCartonCount,
          remark: body.remark?.trim() || row.remark || undefined,
          measuredAt: null,
          totalVolumeCbm: null,
          totalGrossWeightKg: null,
          totalChargeableWeightKg: null,
          estimatedFeeTotal: null,
          feeCalculatedAt: null,
          feeStatus: 'none',
        },
        include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
      })
    })

    await this.opLog.log({
      module: 'returns',
      action: 're_receive',
      targetType: 'return_order',
      targetId: row.returnNo,
      operatorId: userId,
      detail: { receivedQty, receivedCartonCount, previousStatus: row.status },
    })
    void this.pushReturnStatusToOms(row.returnNo)
    return this.enrichRow(updated)
  }

  async measure(id: number, body: { cartons: CartonInput[] }, userId: number) {
    const row = await this.prisma.returnOrder.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('退件单不存在')
    if (!['received', 'arrived', 'measured', 'fee_calculated'].includes(row.status)) {
      throw new BadRequestException('当前状态不可测量，请先完成收货')
    }
    const cartons = Array.isArray(body.cartons) ? body.cartons : []
    if (!cartons.length) throw new BadRequestException('请至少录入 1 箱外箱尺寸')

    let computed
    try {
      computed = computeCartonMeasures(cartons)
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : '外箱尺寸无效')
    }
    const totals = sumCartonTotals(computed)

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.returnCartonMeasure.deleteMany({ where: { returnId: row.id } })
      for (const c of computed) {
        await tx.returnCartonMeasure.create({
          data: {
            returnId: row.id,
            cartonNo: c.cartonNo,
            lengthCm: c.lengthCm,
            widthCm: c.widthCm,
            heightCm: c.heightCm,
            grossWeightKg: c.grossWeightKg,
            volumeCbm: c.volumeCbm,
            volumetricWeightKg: c.volumetricWeightKg,
            chargeableWeightKg: c.chargeableWeightKg,
          },
        })
      }
      return tx.returnOrder.update({
        where: { id: row.id },
        data: {
          status: 'measured',
          measuredAt: new Date(),
          totalVolumeCbm: totals.totalVolumeCbm,
          totalGrossWeightKg: totals.totalGrossWeightKg,
          totalChargeableWeightKg: totals.totalChargeableWeightKg,
          feeStatus: 'none',
          estimatedFeeTotal: null,
          feeCalculatedAt: null,
        },
        include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
      })
    })

    await this.clearPendingAutoReturnCharges(row.returnNo)
    await this.opLog.log({
      module: 'returns',
      action: 'return_measure',
      targetType: 'return_order',
      targetId: row.returnNo,
      operatorId: userId,
      detail: { cartonCount: computed.length, ...totals },
    })
    void this.pushReturnStatusToOms(row.returnNo)
    return this.enrichRow(updated)
  }

  async listFeeTemplates() {
    await this.ensureMissingWarehouseTemplates()
    const rows = await this.prisma.returnFeeTemplate.findMany({
      where: {
        status: 'active',
        warehouseCode: { in: [...RETURN_WAREHOUSES] },
      },
      include: { rules: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { warehouseCode: 'asc' },
    })
    return rows.map((t) => this.mapFeeTemplate(t))
  }

  async getActiveFeeTemplate(_customerId?: number, warehouseCode?: string) {
    const template = await this.resolveWarehouseFeeTemplate(warehouseCode || null)
    return this.mapFeeTemplate(template)
  }

  async createFeeTemplate(
    body: {
      templateName?: string
      warehouseCode: string
      rules: {
        chargeType?: string
        description?: string
        calcMode?: string
        unitPrice?: number
        minQty?: number | null
        sortOrder?: number
        autoApply?: boolean
      }[]
    },
    userId: number,
  ) {
    const wh = normalizeReturnWarehouse(body.warehouseCode)
    if (!wh) throw new BadRequestException('请选择有效退件仓库（JHB3 / CPT2 / DBN）')

    const exists = await this.prisma.returnFeeTemplate.findFirst({
      where: { status: 'active', warehouseCode: wh },
    })
    if (exists) throw new BadRequestException(`${wh} 仓库已有收费模板，请直接编辑或先删除`)

    let normalizedRules: FeeTemplateRule[]
    try {
      normalizedRules = normalizeTemplateRulesInput(body.rules || [])
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : '收费规则无效')
    }

    const templateName = body.templateName?.trim() || `${wh} 退件收费`

    const inactive = await this.prisma.returnFeeTemplate.findFirst({
      where: { status: 'inactive', warehouseCode: wh },
    })
    if (inactive) {
      const revived = await this.prisma.$transaction(async (tx) => {
        await tx.returnFeeTemplateRule.deleteMany({ where: { templateId: inactive.id } })
        for (const rule of normalizedRules) {
          await tx.returnFeeTemplateRule.create({
            data: {
              templateId: inactive.id,
              chargeType: rule.chargeType,
              description: rule.description,
              calcMode: rule.calcMode,
              unitPrice: rule.unitPrice,
              minQty: rule.minQty,
              sortOrder: rule.sortOrder,
              autoApply: rule.autoApply !== false,
            },
          })
        }
        return tx.returnFeeTemplate.update({
          where: { id: inactive.id },
          data: { templateName, status: 'active', customerId: null },
          include: { rules: { orderBy: { sortOrder: 'asc' } } },
        })
      })
      await this.opLog.log({
        module: 'returns',
        action: 'return_fee_template_create',
        targetType: 'return_fee_template',
        targetId: inactive.templateCode,
        operatorId: userId,
        detail: { warehouseCode: wh, ruleCount: normalizedRules.length, revived: true },
      })
      return this.mapFeeTemplate(revived)
    }

    const templateCode = `wh_${wh.toLowerCase()}`

    const created = await this.prisma.returnFeeTemplate.create({
      data: {
        templateCode,
        templateName,
        isDefault: false,
        warehouseCode: wh,
        customerId: null,
        status: 'active',
        rules: {
          create: normalizedRules.map((rule) => ({
            chargeType: rule.chargeType,
            description: rule.description,
            calcMode: rule.calcMode,
            unitPrice: rule.unitPrice,
            minQty: rule.minQty,
            sortOrder: rule.sortOrder,
            autoApply: rule.autoApply !== false,
          })),
        },
      },
      include: { rules: { orderBy: { sortOrder: 'asc' } } },
    })

    await this.opLog.log({
      module: 'returns',
      action: 'return_fee_template_create',
      targetType: 'return_fee_template',
      targetId: templateCode,
      operatorId: userId,
      detail: { warehouseCode: wh, ruleCount: normalizedRules.length },
    })

    return this.mapFeeTemplate(created)
  }

  async deleteFeeTemplate(id: number, userId: number) {
    const row = await this.prisma.returnFeeTemplate.findUnique({ where: { id: BigInt(id) } })
    if (!row || row.status !== 'active') throw new NotFoundException('收费模板不存在')

    await this.prisma.returnFeeTemplate.update({
      where: { id: row.id },
      data: { status: 'inactive' },
    })

    await this.opLog.log({
      module: 'returns',
      action: 'return_fee_template_delete',
      targetType: 'return_fee_template',
      targetId: row.templateCode,
      operatorId: userId,
      detail: { warehouseCode: row.warehouseCode },
    })

    return { ok: true }
  }

  async previewReturnFees(
    id: number,
    body: { cartons: CartonInput[]; extraLines?: { description?: string; amount?: number; quantity?: number; unitPrice?: number }[] },
  ) {
    const row = await this.prisma.returnOrder.findUnique({
      where: { id: BigInt(id) },
      include: { items: true },
    })
    if (!row) throw new NotFoundException('退件单不存在')
    const cartons = Array.isArray(body.cartons) ? body.cartons : []
    if (!cartons.length) throw new BadRequestException('请至少录入 1 箱外箱尺寸')
    let computed
    try {
      computed = computeCartonMeasures(cartons)
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : '外箱尺寸无效')
    }
    const totals = sumCartonTotals(computed)
    const template = await this.resolveWarehouseFeeTemplate(row.returnWarehouse)
    const rules = mapDbTemplateRules(template.rules || [])
    const ctx = buildFeePreviewContext({
      cartonCount: computed.length,
      totalVolumeCbm: totals.totalVolumeCbm,
      totalChargeableWeightKg: totals.totalChargeableWeightKg,
      receivedQty: row.receivedQty,
      items: row.items,
    })
    const autoLines = buildMeasurePhaseFeeLines(ctx, rules)
    const autoTotal = autoLines.reduce((s, l) => s + l.amount, 0)
    return {
      template: this.mapFeeTemplate(template),
      totals,
      context: ctx,
      autoLines,
      autoTotal,
      estimatedTotal: round2Amount(autoTotal),
    }
  }

  async calculateFees(
    id: number,
    userId: number,
    _body?: { extraLines?: { description?: string; amount?: number; quantity?: number; unitPrice?: number }[] },
  ) {
    const row = await this.prisma.returnOrder.findUnique({
      where: { id: BigInt(id) },
      include: { items: true, cartons: { orderBy: { cartonNo: 'asc' } } },
    })
    if (!row) throw new NotFoundException('退件单不存在')
    if (row.status !== 'measured') {
      throw new BadRequestException('请先完成外箱体积测量，再生成费用')
    }
    if (!row.cartons.length) {
      throw new BadRequestException('缺少外箱测量数据')
    }

    const totalVolumeCbm = Number(row.totalVolumeCbm || 0)
    const template = await this.resolveWarehouseFeeTemplate(row.returnWarehouse)
    const rules = mapDbTemplateRules(template.rules || [])
    const ctx = buildFeePreviewContext({
      cartonCount: row.cartons.length,
      totalVolumeCbm,
      totalChargeableWeightKg: Number(row.totalChargeableWeightKg || 0),
      receivedQty: row.receivedQty,
      items: row.items,
    })
    const autoLines = buildMeasurePhaseFeeLines(ctx, rules)
    const estimatedFeeTotal = autoLines.reduce((s, l) => s + l.amount, 0)

    await this.clearPendingAutoReturnCharges(row.returnNo)
    await this.clearPendingManualExtraCharges(row.returnNo)
    for (const line of autoLines) {
      await this.createReturnCharge({
        customerId: Number(row.customerId),
        returnNo: row.returnNo,
        warehouseCode: row.returnWarehouse || undefined,
        source: 'wms',
        ...line,
      })
    }

    const updated = await this.prisma.returnOrder.update({
      where: { id: row.id },
      data: {
        status: 'fee_calculated',
        feeCalculatedAt: new Date(),
        estimatedFeeTotal,
        feeStatus: 'estimated',
      },
      include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
    })

    await this.opLog.log({
      module: 'returns',
      action: 'return_calc_fee',
      targetType: 'return_order',
      targetId: row.returnNo,
      operatorId: userId,
      detail: {
        estimatedFeeTotal,
        templateCode: template.templateCode,
        autoLines,
        phase: 'measure_logistics_only',
      },
    })
    void this.pushReturnStatusToOms(row.returnNo)
    const enriched = this.enrichRow(updated)
    const loadedFeeLines = await this.loadFeeLines(row.returnNo)
    return { ...enriched, feeLines: loadedFeeLines }
  }

  async updateFeeTemplate(
    id: number,
    body: {
      templateName?: string
      warehouseCode?: string | null
      customerId?: number | null
      rules: {
        chargeType?: string
        description?: string
        calcMode?: string
        unitPrice?: number
        minQty?: number | null
        sortOrder?: number
        autoApply?: boolean
      }[]
    },
    userId: number,
  ) {
    const row = await this.prisma.returnFeeTemplate.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('收费模板不存在')
    if (row.status !== 'active') throw new BadRequestException('模板已停用，不可编辑')

    let normalizedRules: FeeTemplateRule[]
    try {
      normalizedRules = normalizeTemplateRulesInput(body.rules || [])
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : '收费规则无效')
    }

    const templateName = body.templateName?.trim() || row.templateName
    if (!templateName) throw new BadRequestException('模板名称不能为空')

    const warehouseCode = body.warehouseCode !== undefined
      ? (body.warehouseCode?.trim().toUpperCase() || null)
      : row.warehouseCode
    if (!warehouseCode || !isValidReturnWarehouse(warehouseCode)) {
      throw new BadRequestException('须指定有效退件仓库（JHB3 / CPT2 / DBN）')
    }

    const wh = normalizeReturnWarehouse(warehouseCode)!
    const conflict = await this.prisma.returnFeeTemplate.findFirst({
      where: { status: 'active', warehouseCode: wh, id: { not: row.id } },
    })
    if (conflict) throw new BadRequestException(`${wh} 仓库已有其他收费模板`)

    const customerId = null as bigint | null

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.returnFeeTemplateRule.deleteMany({ where: { templateId: row.id } })
      for (const rule of normalizedRules) {
        await tx.returnFeeTemplateRule.create({
          data: {
            templateId: row.id,
            chargeType: rule.chargeType,
            description: rule.description,
            calcMode: rule.calcMode,
            unitPrice: rule.unitPrice,
            minQty: rule.minQty,
            sortOrder: rule.sortOrder,
            autoApply: rule.autoApply !== false,
          },
        })
      }
      return tx.returnFeeTemplate.update({
        where: { id: row.id },
        data: {
          templateName,
          warehouseCode: wh,
          customerId,
        },
        include: { rules: { orderBy: { sortOrder: 'asc' } } },
      })
    })

    await this.opLog.log({
      module: 'returns',
      action: 'return_fee_template_update',
      targetType: 'return_fee_template',
      targetId: row.templateCode,
      operatorId: userId,
      detail: { templateName, ruleCount: normalizedRules.length },
    })

    return this.mapFeeTemplate(updated)
  }

  private mapFeeTemplate(template: {
    id: bigint
    templateCode: string
    templateName: string
    isDefault: boolean
    warehouseCode: string | null
    customerId: bigint | null
    rules?: {
      chargeType: string
      description: string
      calcMode: string
      unitPrice: { toNumber?: () => number } | number
      minQty: { toNumber?: () => number } | number | null
      sortOrder: number
      autoApply: boolean
    }[]
  }) {
    return {
      id: Number(template.id),
      templateCode: template.templateCode,
      templateName: template.templateName,
      isDefault: template.isDefault,
      warehouseCode: template.warehouseCode,
      customerId: template.customerId != null ? Number(template.customerId) : null,
      rules: mapDbTemplateRules(template.rules || []).map((r) => ({
        chargeType: r.chargeType,
        description: r.description,
        calcMode: r.calcMode,
        unitPrice: r.unitPrice,
        minQty: r.minQty,
        sortOrder: r.sortOrder,
        autoApply: r.autoApply !== false,
      })),
    }
  }

  private async ensureMissingWarehouseTemplates() {
    for (const wh of RETURN_WAREHOUSES) {
      const exists = await this.prisma.returnFeeTemplate.findFirst({
        where: { status: 'active', warehouseCode: wh },
      })
      if (exists) continue
      const rules = defaultMeasureFeeRules(wh)
      await this.prisma.returnFeeTemplate.create({
        data: {
          templateCode: `wh_${wh.toLowerCase()}`,
          templateName: `${wh} 退件收费`,
          isDefault: false,
          warehouseCode: wh,
          customerId: null,
          status: 'active',
          rules: {
            create: rules.map((rule) => ({
              chargeType: rule.chargeType,
              description: rule.description,
              calcMode: rule.calcMode,
              unitPrice: rule.unitPrice,
              minQty: rule.minQty,
              sortOrder: rule.sortOrder,
              autoApply: rule.autoApply !== false,
            })),
          },
        },
      })
    }
  }

  private async resolveWarehouseFeeTemplate(warehouseCode: string | null) {
    const wh = normalizeReturnWarehouse(warehouseCode)
    if (!wh) {
      throw new BadRequestException('退件单缺少有效退件仓库，无法匹配收费模板')
    }
    await this.ensureMissingWarehouseTemplates()
    const row = await this.prisma.returnFeeTemplate.findFirst({
      where: { status: 'active', warehouseCode: wh },
      include: { rules: { where: { autoApply: true }, orderBy: { sortOrder: 'asc' } } },
    })
    if (!row?.rules?.length) {
      throw new BadRequestException(`${wh} 仓库尚未配置退件收费模板，请先在「收费模板」中创建`)
    }
    return row
  }

  private async nextChargeSuffix(customerId: number): Promise<string> {
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      'SELECT charge_no FROM billing_charge WHERE customer_id = ? ORDER BY id DESC LIMIT 1',
      customerId,
    )
    const last = String(rows[0]?.charge_no || '')
    const match = last.match(/CHG-(\d+)$/)
    const next = match ? Number(match[1]) + 1 : 1
    return `CHG-${String(next).padStart(3, '0')}`
  }

  private async createReturnCharge(data: {
    customerId: number
    returnNo: string
    warehouseCode?: string
    source?: 'wms' | 'manual'
    chargeType: string
    description: string
    quantity: number
    unitPrice: number
    amount: number
  }) {
    const customer = await this.prisma.customer.findUnique({ where: { id: BigInt(data.customerId) } })
    if (!customer) throw new NotFoundException('客户不存在')
    const suffix = await this.nextChargeSuffix(data.customerId)
    const prefix = customer.customerCode ? `${customer.customerCode}-` : ''
    const chargeNo = `${prefix}${suffix}`
    const chargeDate = new Date().toISOString().slice(0, 10)
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO billing_charge (charge_no, customer_id, charge_type, source, description, amount, quantity, unit_price, charge_date, biz_ref, source_ref, warehouse_code, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      chargeNo,
      BigInt(data.customerId),
      data.chargeType,
      data.source || 'wms',
      data.description,
      data.amount,
      data.quantity,
      data.unitPrice,
      chargeDate,
      data.returnNo,
      data.returnNo,
      data.warehouseCode || 'WMS-JHB-01',
    )
    void this.billing.pushCustomerBillingToOms(data.customerId)
  }

  private async clearPendingAutoReturnCharges(returnNo: string) {
    const types = RETURN_AUTO_CHARGE_TYPES.map((t) => `'${t}'`).join(', ')
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM billing_charge
       WHERE biz_ref = ? AND status = 'pending'
         AND charge_type IN (${types})`,
      returnNo,
    )
  }

  private async clearPendingManualExtraCharges(returnNo: string) {
    const types = RETURN_MANUAL_CHARGE_TYPES.map((t) => `'${t}'`).join(', ')
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM billing_charge
       WHERE biz_ref = ? AND status = 'pending'
         AND source = 'manual'
         AND charge_type IN (${types})`,
      returnNo,
    )
  }

  private async clearPendingReturnCharges(returnNo: string) {
    const types = ALL_RETURN_CHARGE_TYPES.map((t) => `'${t}'`).join(', ')
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM billing_charge
       WHERE biz_ref = ? AND status = 'pending'
         AND charge_type IN (${types})`,
      returnNo,
    )
  }

  private async clearPendingDecisionCharges(returnNo: string) {
    const types = RETURN_DECISION_CHARGE_TYPES.map((t) => `'${t}'`).join(', ')
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM billing_charge
       WHERE biz_ref = ? AND status = 'pending'
         AND charge_type IN (${types})`,
      returnNo,
    )
  }

  private async refreshEstimatedFeeTotal(returnId: bigint, returnNo: string) {
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(amount), 0) as total FROM billing_charge WHERE biz_ref = ? AND status = 'pending'`,
      returnNo,
    )
    const total = Number(rows[0]?.total ?? 0)
    await this.prisma.returnOrder.update({
      where: { id: returnId },
      data: { estimatedFeeTotal: total, feeStatus: total > 0 ? 'estimated' : 'none' },
    })
    return total
  }

  private async loadFeeLines(returnNo: string) {
    const types = ALL_RETURN_CHARGE_TYPES.map((t) => `'${t}'`).join(', ')
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT charge_type, description, quantity, unit_price, amount, status
       FROM billing_charge
       WHERE biz_ref = ? AND charge_type IN (${types})
       ORDER BY id ASC`,
      returnNo,
    )
    return rows.map((r) => ({
      chargeType: r.charge_type,
      description: r.description,
      quantity: Number(r.quantity),
      unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
      amount: Number(r.amount),
      status: r.status,
    }))
  }

  async submitInspection(
    id: number,
    body: {
      inspectionResult: string
      inspectionRemark?: string
      attachments?: { fileName: string; contentBase64?: string; url?: string }[]
    },
    userId: number,
  ) {
    const inspectionResult = String(body.inspectionResult || '').trim()
    if (!isValidInspectionResult(inspectionResult)) {
      throw new BadRequestException('请选择质检结论（良品/不良品/混合/待判定）')
    }
    const row = await this.prisma.returnOrder.findUnique({
      where: { id: BigInt(id) },
      include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
    })
    if (!row) throw new NotFoundException('退件单不存在')
    if (row.status !== 'fee_calculated') {
      throw new BadRequestException('请先完成测体积与算费，再提交质检')
    }

    const normalized = this.normalizeAttachments(
      (body.attachments || []).map((a) => ({ ...a, fileType: 'inspection_photo' })),
    )
    if (!normalized.length) {
      throw new BadRequestException('请至少上传 1 张质检照片')
    }

    const deadline = new Date()
    deadline.setHours(deadline.getHours() + RETURN_FEE_RATES.decisionDeadlineHours)

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const att of normalized) {
        const saved = this.writeAttachment(att.fileName, att.contentBase64)
        await tx.returnAttachment.create({
          data: {
            returnId: row.id,
            fileType: 'inspection_photo',
            fileName: saved.fileName,
            filePath: saved.filePath,
          },
        })
      }
      return tx.returnOrder.update({
        where: { id: row.id },
        data: {
          status: 'awaiting_customer',
          inspectionResult,
          inspectionRemark: body.inspectionRemark?.trim() || undefined,
          inspectedAt: new Date(),
          inspectedBy: BigInt(userId),
          customerDecision: 'pending',
          customerDecidedAt: null,
          customerProcessChoice: null,
          decisionDeadline: deadline,
        },
        include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
      })
    })

    await this.opLog.log({
      module: 'returns',
      action: 'return_inspect',
      targetType: 'return_order',
      targetId: row.returnNo,
      operatorId: userId,
      detail: { inspectionResult, photoCount: normalized.length },
    })
    void this.pushReturnStatusToOms(row.returnNo)
    return this.enrichRow(updated)
  }

  async decideFromOms(
    returnNo: string,
    body: { customerCode?: string; decision: 'keep' | 'discard'; processChoice?: string },
  ) {
    const no = returnNo.trim()
    if (!no) throw new BadRequestException('缺少退件单号')
    const decision = body.decision
    if (decision !== 'keep' && decision !== 'discard') {
      throw new BadRequestException('decision 须为 keep 或 discard')
    }

    const row = await this.prisma.returnOrder.findUnique({
      where: { returnNo: no },
      include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
    })
    if (!row) throw new NotFoundException(`退件单 ${no} 不存在`)
    const code = body.customerCode?.trim()
    if (!code) throw new BadRequestException('缺少 customerCode')
    if (!row.omsCustomerCode || row.omsCustomerCode !== code) {
      throw new BadRequestException('客户编码与退件单不匹配')
    }
    if (row.status !== 'awaiting_customer') {
      throw new BadRequestException('当前状态不可确认，仅「待客户确认」可操作')
    }

    const totalQty = row.receivedQty ?? row.items.reduce((s, i) => s + i.quantity, 0)
    const totalVolumeCbm = Number(row.totalVolumeCbm || 0)

    await this.clearPendingDecisionCharges(no)

    let nextStatus: string
    let customerProcessChoice: string | null = null

    if (decision === 'discard') {
      nextStatus = 'dispose_pending'
      const feeLines = buildDiscardFeeLines(totalVolumeCbm)
      for (const line of feeLines) {
        await this.createReturnCharge({
          customerId: Number(row.customerId),
          returnNo: no,
          warehouseCode: row.returnWarehouse || undefined,
          ...line,
        })
      }
    } else {
      const processChoice = String(body.processChoice || row.requestedProcess || 'restock').trim()
      if (!isValidProcessMethod(processChoice) || processChoice === 'destroy') {
        throw new BadRequestException('留货时请选择有效的处理方式')
      }
      customerProcessChoice = processChoice
      nextStatus = 'accepted_pending'
      const feeLines = buildKeepFeeLines(processChoice as ReturnProcessMethod, totalQty)
      for (const line of feeLines) {
        await this.createReturnCharge({
          customerId: Number(row.customerId),
          returnNo: no,
          warehouseCode: row.returnWarehouse || undefined,
          ...line,
        })
      }
    }

    const estimatedFeeTotal = await this.refreshEstimatedFeeTotal(row.id, no)

    const updated = await this.prisma.returnOrder.update({
      where: { id: row.id },
      data: {
        status: nextStatus,
        customerDecision: decision,
        customerDecidedAt: new Date(),
        customerProcessChoice,
        feeStatus: 'confirmed',
        estimatedFeeTotal,
      },
      include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
    })

    await this.opLog.log({
      module: 'returns',
      action: 'return_customer_decide',
      targetType: 'return_order',
      targetId: no,
      detail: { decision, processChoice: customerProcessChoice, estimatedFeeTotal },
    })
    void this.pushReturnStatusToOms(no)
    return { ...this.mapReturnForOms(updated), idempotent: false }
  }

  async executeDispose(id: number, body: { processRemark?: string }, userId: number) {
    const row = await this.prisma.returnOrder.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('退件单不存在')
    if (row.status !== 'dispose_pending') {
      throw new BadRequestException('当前状态不可销毁，仅「待销毁」可确认')
    }
    const updated = await this.prisma.returnOrder.update({
      where: { id: row.id },
      data: {
        status: 'completed',
        processResult: 'destroy',
        processRemark: body.processRemark?.trim() || '客户确认不留，已销毁',
        processedAt: new Date(),
        processedBy: BigInt(userId),
      },
      include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
    })
    await this.opLog.log({
      module: 'returns',
      action: 'return_dispose',
      targetType: 'return_order',
      targetId: row.returnNo,
      operatorId: userId,
    })
    void this.pushReturnStatusToOms(row.returnNo)
    return this.enrichRow(updated)
  }

  async process(
    id: number,
    body: { processResult?: string; processRemark?: string },
    userId: number,
  ) {
    const row = await this.prisma.returnOrder.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('退件单不存在')
    if (row.status === 'accepted_pending') {
      const processResult = String(body.processResult || row.customerProcessChoice || row.requestedProcess || '').trim()
      if (!isValidProcessMethod(processResult) || processResult === 'destroy') {
        throw new BadRequestException('无效的处理结果')
      }
      const updated = await this.prisma.returnOrder.update({
        where: { id: row.id },
        data: {
          status: 'completed',
          processResult,
          processRemark: body.processRemark?.trim() || undefined,
          processedAt: new Date(),
          processedBy: BigInt(userId),
        },
        include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
      })
      await this.opLog.log({
        module: 'returns',
        action: 'process',
        targetType: 'return_order',
        targetId: row.returnNo,
        operatorId: userId,
        detail: { processResult, processRemark: body.processRemark },
      })
      void this.pushReturnStatusToOms(row.returnNo)
      return this.enrichRow(updated)
    }
    if (!['arrived', 'processing'].includes(row.status)) {
      throw new BadRequestException('请先完成质检与客户确认，或当前状态不可处理')
    }
    const processResult = String(body.processResult || '').trim()
    if (!isValidProcessMethod(processResult) || processResult === 'destroy') {
      throw new BadRequestException('无效的处理结果')
    }
    const updated = await this.prisma.returnOrder.update({
      where: { id: row.id },
      data: {
        status: 'completed',
        processResult,
        processRemark: body.processRemark?.trim() || undefined,
        processedAt: new Date(),
        processedBy: BigInt(userId),
      },
      include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
    })
    await this.opLog.log({
      module: 'returns',
      action: 'process',
      targetType: 'return_order',
      targetId: row.returnNo,
      operatorId: userId,
      detail: { processResult, processRemark: body.processRemark },
    })
    void this.pushReturnStatusToOms(row.returnNo)
    return this.enrichRow(updated)
  }

  private applyDateRange(
    where: Record<string, unknown>,
    field: string,
    from?: string,
    to?: string,
  ) {
    if (!from?.trim() && !to?.trim()) return
    const range: Record<string, Date> = {}
    if (from?.trim()) range.gte = new Date(from.trim())
    if (to?.trim()) {
      const end = new Date(to.trim())
      end.setHours(23, 59, 59, 999)
      range.lte = end
    }
    where[field] = range
  }

  private enrichRow(row: {
    id: bigint
    returnNo: string
    customerId: bigint
    omsCustomerCode: string | null
    orderNo: string
    referenceNo: string | null
    trackingNo: string | null
    sellerStoreName: string | null
    sellerTaxNo: string | null
    returnWarehouse: string | null
    expectedArrivalAt: Date | null
    returnReason: string
    returnDescription: string | null
    requestedProcess: string
    status: string
    processResult: string | null
    processRemark: string | null
    receivedAt: Date | null
    receivedQty: number | null
    receivedCartonCount: number | null
    totalVolumeCbm: { toNumber?: () => number } | number | null
    totalGrossWeightKg: { toNumber?: () => number } | number | null
    totalChargeableWeightKg: { toNumber?: () => number } | number | null
    estimatedFeeTotal: { toNumber?: () => number } | number | null
    feeStatus: string | null
    measuredAt: Date | null
    feeCalculatedAt: Date | null
    processedAt: Date | null
    remark: string | null
    createdAt: Date
    updatedAt: Date
    items: { id: bigint; sku: string; productName: string; quantity: number }[]
    attachments?: { id: bigint; fileType: string; fileName: string; createdAt: Date }[]
    cartons?: {
      id: bigint
      cartonNo: number
      lengthCm: { toNumber?: () => number } | number
      widthCm: { toNumber?: () => number } | number
      heightCm: { toNumber?: () => number } | number
      grossWeightKg: { toNumber?: () => number } | number
      volumeCbm: { toNumber?: () => number } | number
      volumetricWeightKg: { toNumber?: () => number } | number
      chargeableWeightKg: { toNumber?: () => number } | number
    }[]
  }) {
    const totalQty = row.items.reduce((s, i) => s + i.quantity, 0)
    const num = (v: { toNumber?: () => number } | number | null | undefined) => {
      if (v == null) return null
      if (typeof v === 'number') return v
      if (typeof v.toNumber === 'function') return v.toNumber()
      return Number(v)
    }
    return {
      ...row,
      id: Number(row.id),
      customerId: Number(row.customerId),
      statusLabel: RETURN_STATUS_LABELS[row.status] || row.status,
      requestedProcessLabel: processMethodLabel(row.requestedProcess),
      processResultLabel: processMethodLabel(row.processResult),
      totalQty,
      receivedQty: row.receivedQty ?? totalQty,
      receivedCartonCount: row.receivedCartonCount,
      totalVolumeCbm: num(row.totalVolumeCbm),
      totalGrossWeightKg: num(row.totalGrossWeightKg),
      totalChargeableWeightKg: num(row.totalChargeableWeightKg),
      estimatedFeeTotal: num(row.estimatedFeeTotal),
      feeStatus: row.feeStatus || 'none',
      inspectionResult: (row as any).inspectionResult ?? null,
      inspectionResultLabel: inspectionResultLabel((row as any).inspectionResult),
      inspectionRemark: (row as any).inspectionRemark ?? null,
      inspectedAt: (row as any).inspectedAt ?? null,
      customerDecision: (row as any).customerDecision ?? 'pending',
      customerDecisionLabel: CUSTOMER_DECISION_LABELS[(row as any).customerDecision || 'pending'] || '—',
      customerDecidedAt: (row as any).customerDecidedAt ?? null,
      customerProcessChoice: (row as any).customerProcessChoice ?? null,
      customerProcessChoiceLabel: processMethodLabel((row as any).customerProcessChoice),
      decisionDeadline: (row as any).decisionDeadline ?? null,
      attachments: this.mapAttachments(row.attachments || []),
      inspectionPhotos: this.mapAttachments((row.attachments || []).filter((a) => a.fileType === 'inspection_photo')),
      omsAttachments: this.mapAttachments((row.attachments || []).filter((a) => a.fileType !== 'inspection_photo')),
      cartons: (row.cartons || []).map((c) => ({
        id: Number(c.id),
        cartonNo: c.cartonNo,
        lengthCm: num(c.lengthCm),
        widthCm: num(c.widthCm),
        heightCm: num(c.heightCm),
        grossWeightKg: num(c.grossWeightKg),
        volumeCbm: num(c.volumeCbm),
        volumetricWeightKg: num(c.volumetricWeightKg),
        chargeableWeightKg: num(c.chargeableWeightKg),
      })),
      items: row.items.map((i) => ({
        ...i,
        id: Number(i.id),
        returnId: Number(row.id),
      })),
    }
  }

  mapReturnForOms(row: {
    id: bigint
    returnNo: string
    omsCustomerCode: string | null
    orderNo: string
    referenceNo: string | null
    trackingNo: string | null
    sellerStoreName: string | null
    sellerTaxNo: string | null
    returnWarehouse: string | null
    expectedArrivalAt: Date | null
    returnReason: string
    returnDescription: string | null
    requestedProcess: string
    status: string
    processResult: string | null
    processRemark: string | null
    receivedAt: Date | null
    receivedQty: number | null
    receivedCartonCount: number | null
    totalVolumeCbm: { toNumber?: () => number } | number | null
    totalGrossWeightKg: { toNumber?: () => number } | number | null
    totalChargeableWeightKg: { toNumber?: () => number } | number | null
    estimatedFeeTotal: { toNumber?: () => number } | number | null
    feeStatus: string | null
    measuredAt: Date | null
    feeCalculatedAt: Date | null
    processedAt: Date | null
    createdAt: Date
    updatedAt: Date
    items: { sku: string; productName: string; quantity: number }[]
    attachments?: { id: bigint; fileType: string; fileName: string; createdAt: Date }[]
    cartons?: {
      cartonNo: number
      lengthCm: { toNumber?: () => number } | number
      widthCm: { toNumber?: () => number } | number
      heightCm: { toNumber?: () => number } | number
      grossWeightKg: { toNumber?: () => number } | number
      volumeCbm: { toNumber?: () => number } | number
      volumetricWeightKg: { toNumber?: () => number } | number
      chargeableWeightKg: { toNumber?: () => number } | number
    }[]
  }) {
    const num = (v: { toNumber?: () => number } | number | null | undefined) => {
      if (v == null) return null
      if (typeof v === 'number') return v
      if (typeof v.toNumber === 'function') return v.toNumber()
      return Number(v)
    }
    return {
      id: Number(row.id),
      returnNo: row.returnNo,
      customerCode: row.omsCustomerCode || '',
      orderNo: row.orderNo,
      referenceNo: row.referenceNo || '',
      trackingNo: row.trackingNo || '',
      sellerStoreName: row.sellerStoreName || '',
      sellerTaxNo: row.sellerTaxNo || '',
      returnWarehouse: row.returnWarehouse || '',
      expectedArrivalAt: row.expectedArrivalAt?.toISOString() || null,
      returnReason: row.returnReason,
      returnDescription: row.returnDescription || '',
      requestedProcess: row.requestedProcess,
      requestedProcessLabel: processMethodLabel(row.requestedProcess),
      status: row.status,
      statusLabel: RETURN_STATUS_LABELS[row.status] || row.status,
      processResult: row.processResult || '',
      processResultLabel: processMethodLabel(row.processResult),
      processRemark: row.processRemark || '',
      receivedAt: row.receivedAt?.toISOString() || null,
      receivedQty: row.receivedQty,
      receivedCartonCount: row.receivedCartonCount,
      totalVolumeCbm: num(row.totalVolumeCbm),
      totalGrossWeightKg: num(row.totalGrossWeightKg),
      totalChargeableWeightKg: num(row.totalChargeableWeightKg),
      estimatedFeeTotal: num(row.estimatedFeeTotal),
      feeStatus: row.feeStatus || 'none',
      measuredAt: row.measuredAt?.toISOString() || null,
      feeCalculatedAt: row.feeCalculatedAt?.toISOString() || null,
      inspectionResult: (row as any).inspectionResult || '',
      inspectionResultLabel: inspectionResultLabel((row as any).inspectionResult),
      inspectionRemark: (row as any).inspectionRemark || '',
      inspectedAt: (row as any).inspectedAt?.toISOString?.() || null,
      customerDecision: (row as any).customerDecision || 'pending',
      customerDecisionLabel: CUSTOMER_DECISION_LABELS[(row as any).customerDecision || 'pending'] || '',
      customerDecidedAt: (row as any).customerDecidedAt?.toISOString?.() || null,
      customerProcessChoice: (row as any).customerProcessChoice || '',
      customerProcessChoiceLabel: processMethodLabel((row as any).customerProcessChoice),
      decisionDeadline: (row as any).decisionDeadline?.toISOString?.() || null,
      processedAt: row.processedAt?.toISOString() || null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      attachments: this.mapAttachments((row.attachments || []).filter((a) => a.fileType !== 'inspection_photo')),
      inspectionPhotos: this.mapAttachments((row.attachments || []).filter((a) => a.fileType === 'inspection_photo')),
      cartons: (row.cartons || []).map((c) => ({
        cartonNo: c.cartonNo,
        lengthCm: num(c.lengthCm),
        widthCm: num(c.widthCm),
        heightCm: num(c.heightCm),
        grossWeightKg: num(c.grossWeightKg),
        volumeCbm: num(c.volumeCbm),
        volumetricWeightKg: num(c.volumetricWeightKg),
        chargeableWeightKg: num(c.chargeableWeightKg),
      })),
      items: row.items.map((i) => ({
        sku: i.sku,
        productName: i.productName,
        quantity: i.quantity,
      })),
      totalQty: row.items.reduce((s, i) => s + i.quantity, 0),
    }
  }

  async downloadAttachment(id: number, attachmentId: number) {
    const att = await this.prisma.returnAttachment.findFirst({
      where: { id: BigInt(attachmentId), returnId: BigInt(id) },
    })
    if (!att) throw new NotFoundException('附件不存在')
    return {
      fileName: att.fileName,
      content: this.files.read(att.filePath),
    }
  }

  /** OMS：撤回退件（仅待到货） */
  async cancelFromOms(returnNo: string, customerCode?: string) {
    const no = returnNo.trim()
    if (!no) throw new BadRequestException('缺少退件单号')
    const row = await this.prisma.returnOrder.findUnique({
      where: { returnNo: no },
      include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
    })
    if (!row) throw new NotFoundException(`退件单 ${no} 不存在`)
    const code = String(customerCode || '').trim()
    if (!code) throw new BadRequestException('缺少 customerCode')
    if (!row.omsCustomerCode || row.omsCustomerCode !== code) {
      throw new BadRequestException('客户编码与退件单不匹配')
    }
    if (row.status === 'cancelled') {
      return { ...this.mapReturnForOms(row), idempotent: true }
    }
    if (row.status !== 'pending_arrival') {
      throw new BadRequestException('当前状态不可撤回，仅「待到货」可撤回')
    }
    const updated = await this.prisma.returnOrder.update({
      where: { id: row.id },
      data: { status: 'cancelled' },
      include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
    })
    await this.opLog.log({
      module: 'returns',
      action: 'oms_return_cancel',
      targetType: 'return_order',
      targetId: no,
      detail: { customerCode: row.omsCustomerCode },
    })
    void this.pushReturnStatusToOms(no)
    return { ...this.mapReturnForOms(updated), idempotent: false }
  }

  async downloadAttachmentByReturnNo(returnNo: string, attachmentId: number, customerCode: string) {
    const no = returnNo.trim()
    const code = String(customerCode || '').trim()
    if (!code) throw new BadRequestException('缺少 customerCode')
    const row = await this.prisma.returnOrder.findUnique({ where: { returnNo: no } })
    if (!row) throw new NotFoundException(`退件单 ${no} 不存在`)
    if (!row.omsCustomerCode || row.omsCustomerCode !== code) {
      throw new BadRequestException('客户编码与退件单不匹配')
    }
    return this.downloadAttachment(Number(row.id), attachmentId)
  }

  private async pushReturnStatusToOms(returnNo: string) {
    try {
      const row = await this.prisma.returnOrder.findUnique({
        where: { returnNo },
        include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
      })
      if (!row?.omsCustomerCode) return
      void notifyOms('return.status', row.omsCustomerCode, this.mapReturnForOms(row) as Record<string, unknown>)
    } catch (err) {
      console.warn('[returns] push OMS skipped:', err)
    }
  }

  /** 把带客户编码的退货状态再推给 OMS（只发 return.status）。 */
  async replayOmsStatuses(): Promise<{ returnNo: string; status: string; ok: boolean }[]> {
    const rows = await this.prisma.returnOrder.findMany({
      where: { omsCustomerCode: { not: null } },
      include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
      orderBy: { id: 'asc' },
    })
    const out: { returnNo: string; status: string; ok: boolean }[] = []
    for (const row of rows) {
      if (!row.omsCustomerCode) continue
      const payload = this.mapReturnForOms(row)
      const ok = await notifyOms(
        'return.status',
        row.omsCustomerCode,
        payload as unknown as Record<string, unknown>,
      )
      out.push({ returnNo: row.returnNo, status: row.status, ok })
    }
    return out
  }
}
