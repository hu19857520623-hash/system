import { Prisma } from '@prisma/client'
import { ReturnsSyncService } from './returns-sync.service'
import { createHash, randomUUID } from 'crypto'
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { OperationLogService, type OperationLogInput } from '../operation-log/operation-log.service'
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
  buildDiscardFeeLines,
  buildKeepFeeLines,
} from './return-decision-fee.util'
import { buildMeasurePhaseFeeLines, buildFeePreviewContext, defaultMeasureFeeRules, mapDbTemplateRules, normalizeTemplateRulesInput, type FeeTemplateRule } from './return-fee-template.util'
import { ReturnsChargeService } from './returns-charge.service'
import { InventoryMutationService } from '../../common/inventory/inventory-mutation.service'
import { restockReturnToLocations, returnProcessFingerprint, returnRestockProgress, type ReturnProcessInput } from './return-restock.util'
import { isCatalogInternalSku } from '../../common/catalog-customer.util'

function round2Amount(n: number) {
  return Math.round(n * 100) / 100
}

export type ReturnMeasureFeesInput = {
  clientRequestId: string
  mode: 'replace' | 'existing'
  cartons: CartonInput[]
  expectedRevision: string
}

type MeasureFeesReceipt = {
  outcome: 'applied' | 'closed'
  id: number
  returnNo: string
  estimatedFeeTotal: number | null
  customerId?: number
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
    private returnCharges: ReturnsChargeService,
    private inventoryMutation: InventoryMutationService,
    private returnSync: ReturnsSyncService = new ReturnsSyncService(prisma),
  ) {
    this.returnSync.setSender(async (returnNo, warehouseCode) => {
      const row = await this.prisma.returnOrder.findUnique({ where: { returnNo } })
      if (!row) return false
      const results = await Promise.all([this.sendReturnStatusToOms(returnNo), warehouseCode ? this.pushReturnStockToOms(Number(row.id), warehouseCode) : Promise.resolve(true)])
      return results.every(Boolean)
    })
  }

  private returnActionIntent(action: string, id: number, actor: number, body: Record<string, unknown>) {
    const clientRequestId = String(body.clientRequestId || '').trim()
    if (!clientRequestId) return undefined
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientRequestId)) throw new BadRequestException('操作标识无效，请刷新退件页面后重试')
    const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(key => key !== 'clientRequestId').map(key => [key, canonical(value[key])])) : value
    const actionFingerprint = createHash('sha256').update(JSON.stringify({ action, id, actor, body: canonical(body) })).digest('hex')
    return { clientRequestId, actionFingerprint }
  }

  private async hasReturnActionReceipt(tx: Prisma.TransactionClient, actor: number, intent?: { clientRequestId: string; actionFingerprint: string }) {
    if (!intent) return false
    const prior = await tx.operationLog.findFirst({ where: { module: 'returns', operatorId: BigInt(actor), detail: { path: '$.clientRequestId', equals: intent.clientRequestId } }, orderBy: { id: 'desc' } })
    if (!prior) return false
    if ((prior.detail as any)?.actionFingerprint !== intent.actionFingerprint) throw new ConflictException('同一次退件操作的单据或内容已变化，请核对原请求后继续')
    if ((prior.detail as any)?.cancelled) throw new ConflictException('原退件操作已核对结束，请刷新单据后重新操作')
    return true
  }

  private async logReturn(params: OperationLogInput, tx: Prisma.TransactionClient, intent?: { clientRequestId: string; actionFingerprint: string }) {
    await this.opLog.log({ ...params, ...(intent ? { detail: { ...params.detail, ...intent } } : {}) }, tx)
    if (params.targetType === 'return_order') await this.returnSync.enqueue(tx, String(params.targetId))
  }

  async closeWarehouseRequest(id: number, actor: number, input: { action: string; payload: Record<string, unknown> }, disposal = false) {
    const actions = new Map(Object.entries({ receive: 'receive', reReceive: 're_receive', measure: 'return_measure', calculateFees: 'return_calc_fee', submitInspection: 'return_inspect', dispose: 'return_dispose', process: 'process' }))
    const action = actions.get(input?.action)
    if (!action || (action === 'return_dispose' || action === 'process') !== disposal) throw new BadRequestException('请选择本岗位可核对的退件操作')
    const intent = this.returnActionIntent(action, id, actor, input.payload || {})
    if (!intent) throw new BadRequestException('缺少原退件操作标识，不能结束未知请求')
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(actor)} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM return_order WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.returnOrder.findUnique({ where: { id: BigInt(id) } })
      if (!row) throw new NotFoundException('退件单不存在，请核对原单据')
      const prior = await tx.operationLog.findFirst({ where: { module: 'returns', operatorId: BigInt(actor), detail: { path: '$.clientRequestId', equals: intent.clientRequestId } }, orderBy: { id: 'desc' } })
      if (prior) {
        const detail = prior.detail as any
        if (action === 'process' && prior.action === 'process' && prior.targetId === row.returnNo && detail?.requestFingerprint === returnProcessFingerprint(input.payload, String(input.payload.processResult || '').trim())) return { outcome: 'confirmed', currentStatus: row.status }
        if (detail?.actionFingerprint !== intent.actionFingerprint) throw new ConflictException('原操作内容不同，不能清除其它退件请求')
        return { outcome: detail.cancelled ? 'cancelled' : 'confirmed', currentStatus: row.status }
      }
      await this.opLog.log({ module: 'returns', action: 'warehouse_request_closed', targetType: 'return_order', targetId: row.returnNo, operatorId: actor, detail: { ...intent, cancelled: true, originalAction: input.action } }, tx)
      return { outcome: 'cancelled', currentStatus: row.status }
    }, { isolationLevel: 'ReadCommitted' })
  }

  private writeAttachment(fileName: string, contentBase64: string) {
    const buf = Buffer.from(contentBase64, 'base64')
    const { relativePath } = this.files.write('return-attachments', `${randomUUID()}_${fileName}`, buf)
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
    written?: string[],
  ) {
    const normalized = this.normalizeAttachments(attachments)
    for (const att of normalized) {
      const saved = this.writeAttachment(att.fileName, att.contentBase64)
      written?.push(saved.filePath)
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
      items: await this.withRestockProgress(rows.map((r) => this.enrichRow(r))),
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
    const feeLines = await this.returnCharges.loadFeeLines(row.returnNo)
    return { ...(await this.withRestockProgress([enriched]))[0], feeLines }
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
    if (!customerCode) throw new BadRequestException('缺少客户代码')
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
    const parsedItems = lines.map((l) => {
      const sku = String(l.sku || '').trim()
      const quantity = Number(l.quantity ?? 0)
      if (!sku || !Number.isSafeInteger(quantity) || quantity <= 0) throw new BadRequestException('SKU 与数量无效')
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

    const requestFields = ['orderNo', 'referenceNo', 'trackingNo', 'sellerStoreName', 'sellerTaxNo', 'returnWarehouse', 'expectedArrivalAt', 'returnReason', 'returnDescription', 'requestedProcess', 'remark'] as const
    const fieldValue = (value: unknown) => value instanceof Date ? value.toISOString() : value ?? ''
    const itemValues = (items: { sku: string; quantity: number; productName: string | null }[]) => items.map(item => [item.sku, item.quantity, item.productName || item.sku]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    const requestedAttachments = this.normalizeAttachments(data.attachments)
    const requestFingerprint = createHash('sha256').update(JSON.stringify({
      customerCode, fields: requestFields.map(key => fieldValue(returnData[key])), items: itemValues(parsedItems),
      attachments: requestedAttachments.map(file => [file.fileType, file.fileName, createHash('sha256').update(Buffer.from(file.contentBase64, 'base64')).digest('hex')]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    })).digest('hex')
    const written: string[] = []
    const run = () => this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM return_order WHERE return_no = ${returnNo} FOR UPDATE`
      const currentCustomer = await tx.customer.findUnique({ where: { id: customer.id } })
      if (!currentCustomer || currentCustomer.status !== 1) throw new BadRequestException('客户已停用或不存在')
      const existing = await tx.returnOrder.findUnique({ where: { returnNo } })
      if (existing && existing.omsCustomerCode !== customerCode) {
        throw new BadRequestException('客户编码与退件单不匹配，请刷新核对单号')
      }
      if (existing && existing.status !== 'cancelled') {
        const detail = await tx.returnOrder.findUnique({
          where: { id: existing.id },
          include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
        })
        const receipt = await tx.operationLog.findFirst({
          where: { module: 'returns', action: { in: ['oms_return_create', 'oms_return_resubmit'] }, targetId: returnNo },
          orderBy: { id: 'desc' },
        })
        const savedFingerprint = (receipt?.detail as { requestFingerprint?: string } | null)?.requestFingerprint
        if (savedFingerprint) {
          if (savedFingerprint !== requestFingerprint) throw new ConflictException('退件单号已用于不同内容，请核对原单；修改后请先撤回再重新提交')
        } else if (detail) {
          // Older records have no original intent hash. Compare immutable submitted data,
          // leaving warehouse progress and operator remarks out of the compatibility check.
          const sameFields = requestFields.filter(key => key !== 'remark').every(key => fieldValue(detail[key]) === fieldValue(returnData[key]))
          const sameItems = JSON.stringify(itemValues(detail.items)) === JSON.stringify(itemValues(parsedItems))
          const sameFiles = requestedAttachments.every(file => detail.attachments.some(saved => saved.fileName === file.fileName && saved.fileType === file.fileType && this.files.read(saved.filePath).equals(Buffer.from(file.contentBase64, 'base64'))))
          if (!sameFields || !sameItems || !sameFiles) throw new ConflictException('退件单内容与原单不同，请核对原单；修改后请先撤回再重新提交')
        }
        await this.returnSync.enqueue(tx, returnNo)
        return { row: detail!, idempotent: true, reactivated: false }
      }

      let row

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
        await this.persistAttachments(tx, existing.id, data.attachments || [], written)
        row = await tx.returnOrder.findUnique({
          where: { id: existing.id },
          include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
        }) ?? updated
      } else {
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
        await this.persistAttachments(tx, created.id, data.attachments || [], written)
        row = await tx.returnOrder.findUnique({
          where: { id: created.id },
          include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
        })
      }
      if (!row) throw new NotFoundException('退件单创建失败')

      await this.logReturn({
        module: 'returns',
        action: existing?.status === 'cancelled' ? 'oms_return_resubmit' : 'oms_return_create',
        targetType: 'return_order',
        targetId: returnNo,
        detail: { customerCode, orderNo, itemCount: parsedItems.length, reactivated: existing?.status === 'cancelled', requestFingerprint },
      }, tx)
      return { row, idempotent: false, reactivated: existing?.status === 'cancelled' }
    }, { isolationLevel: 'ReadCommitted' })
    const result = await run().catch(error => {
      // A concurrent creation can win the unique return number; re-read its committed row.
      if (error?.code === 'P2002') return run()
      throw error
    }).catch(error => {
      for (const path of written) this.files.remove(path)
      throw error
    })
    // Replays must also repair notifications after an earlier committed response was lost.
    void this.pushReturnStatusToOms(returnNo)
    return { ...this.mapReturnForOms(result.row), idempotent: result.idempotent, reactivated: result.reactivated }
  }

  async receive(
    id: number,
    body: { clientRequestId?: string; receivedQty?: number; receivedCartonCount?: number; remark?: string },
    userId: number,
  ) {
    const updated = await this.prisma.$transaction(async tx => {
      const intent = this.returnActionIntent('receive', id, userId, body)
      if (intent) await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(userId)} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM return_order WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.returnOrder.findUnique({ where: { id: BigInt(id) } })
      if (!row) throw new NotFoundException('退件单不存在')
      if (await this.hasReturnActionReceipt(tx, userId, intent)) return tx.returnOrder.findUniqueOrThrow({ where: { id: BigInt(id) }, include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } } })
      if (row.status !== 'pending_arrival') {
        throw new BadRequestException('当前状态不可收货，仅「在途」可收货')
      }
      const expectedQty = await tx.returnOrderItem.aggregate({
        where: { returnId: row.id },
        _sum: { quantity: true },
      })
      const receivedQty = body.receivedQty != null
        ? Number(body.receivedQty)
        : expectedQty._sum.quantity || 0
      const receivedCartonCount = body.receivedCartonCount != null
        ? Number(body.receivedCartonCount)
        : 1
      if (!Number.isSafeInteger(receivedQty) || receivedQty <= 0) throw new BadRequestException('实收件数须为大于零的整数')
      if (!Number.isSafeInteger(receivedCartonCount) || receivedCartonCount <= 0) throw new BadRequestException('实收箱数须为大于零的整数')

      const updated = await tx.returnOrder.update({
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
      await this.logReturn({
        module: 'returns',
        action: 'receive',
        targetType: 'return_order',
        targetId: row.returnNo,
        operatorId: userId,
        detail: { receivedQty, receivedCartonCount },
      }, tx, intent)
      return updated
    }, { isolationLevel: 'ReadCommitted' })
    void this.pushReturnStatusToOms(updated.returnNo)
    return this.enrichRow(updated)
  }

  async reReceive(
    id: number,
    body: { clientRequestId?: string; receivedQty?: number; receivedCartonCount?: number; remark?: string },
    userId: number,
  ) {
    const updated = await this.prisma.$transaction(async tx => {
      const intent = this.returnActionIntent('re_receive', id, userId, body)
      if (intent) await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(userId)} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM return_order WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.returnOrder.findUnique({ where: { id: BigInt(id) } })
      if (!row) throw new NotFoundException('退件单不存在')
      if (await this.hasReturnActionReceipt(tx, userId, intent)) return tx.returnOrder.findUniqueOrThrow({ where: { id: BigInt(id) }, include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } } })
      if (!(RETURN_RE_RECEIVE_STATUSES as readonly string[]).includes(row.status)) {
        throw new BadRequestException('当前状态不可重新收货，仅已收货/已测体积/已算费可修正')
      }

      const receivedQty = body.receivedQty != null
        ? Number(body.receivedQty)
        : row.receivedQty || 0
      const receivedCartonCount = body.receivedCartonCount != null
        ? Number(body.receivedCartonCount)
        : row.receivedCartonCount || 1
      if (!Number.isSafeInteger(receivedQty) || receivedQty <= 0) throw new BadRequestException('实收件数须为大于零的整数')
      if (!Number.isSafeInteger(receivedCartonCount) || receivedCartonCount <= 0) throw new BadRequestException('实收箱数须为大于零的整数')

      await new ReturnsChargeService(tx as PrismaService, this.billing).clearPendingReturnCharges(row.returnNo)

      await tx.returnCartonMeasure.deleteMany({ where: { returnId: row.id } })
      const updated = await tx.returnOrder.update({
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

      await this.logReturn({
        module: 'returns',
        action: 're_receive',
        targetType: 'return_order',
        targetId: row.returnNo,
        operatorId: userId,
        detail: { receivedQty, receivedCartonCount, previousStatus: row.status },
      }, tx, intent)
      return updated
    }, { isolationLevel: 'ReadCommitted' })
    void this.pushReturnStatusToOms(updated.returnNo)
    return this.enrichRow(updated)
  }

  private async measureInTransaction(tx: Prisma.TransactionClient, id: number, body: { clientRequestId?: string; cartons: CartonInput[] }, userId: number) {
    const intent = this.returnActionIntent('return_measure', id, userId, body)
    if (intent) await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(userId)} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM return_order WHERE id = ${BigInt(id)} FOR UPDATE`
    const row = await tx.returnOrder.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('退件单不存在')
    if (await this.hasReturnActionReceipt(tx, userId, intent)) return tx.returnOrder.findUniqueOrThrow({ where: { id: BigInt(id) }, include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } } })
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
    const updated = await tx.returnOrder.update({
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

    await new ReturnsChargeService(tx as PrismaService, this.billing).clearPendingAutoReturnCharges(row.returnNo)
    await this.logReturn({
      module: 'returns',
      action: 'return_measure',
      targetType: 'return_order',
      targetId: row.returnNo,
      operatorId: userId,
      detail: { cartonCount: computed.length, ...totals },
    }, tx, intent)
    return updated
  }

  async measure(id: number, body: { clientRequestId?: string; cartons: CartonInput[] }, userId: number) {
    const updated = await this.prisma.$transaction(tx => this.measureInTransaction(tx, id, body, userId), { isolationLevel: 'ReadCommitted' })
    void this.pushReturnStatusToOms(updated.returnNo)
    return this.enrichRow(updated)
  }

  private async measurementVersion(tx: Prisma.TransactionClient, row: {
    id: bigint; returnNo: string; status: string; receivedQty: number | null; receivedCartonCount: number | null; measuredAt: Date | null
    cartons: { lengthCm: unknown; widthCm: unknown; heightCm: unknown; grossWeightKg: unknown }[]
  }) {
    const latest = await tx.operationLog.findFirst({ where: { module: 'returns', targetId: row.returnNo, action: { not: 'return_measure_fees_request' } }, orderBy: { id: 'desc' }, select: { id: true } })
    return createHash('sha256').update(JSON.stringify([String(row.id), row.status, row.receivedQty, row.receivedCartonCount, row.measuredAt, String(latest?.id || ''), row.cartons.map(c => [Number(c.lengthCm), Number(c.widthCm), Number(c.heightCm), Number(c.grossWeightKg)])])).digest('hex')
  }

  async measurementSnapshot(id: number) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM return_order WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.returnOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } } })
      if (!row) throw new NotFoundException('退件单不存在')
      return { ...this.enrichRow(row), revision: await this.measurementVersion(tx, row) }
    }, { isolationLevel: 'ReadCommitted' })
  }

  async measureAndCalculate(id: number, body: ReturnMeasureFeesInput, userId: number, closeOnly = false) {
    if (!Number.isSafeInteger(id) || id < 1 || !body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('测量请求资料无效，请重新读取退件')
    const clientRequestId = String(body.clientRequestId || '').trim().toLowerCase()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clientRequestId)) throw new BadRequestException('缺少有效的原测量操作标识，请重新读取原请求')
    if (!['replace', 'existing'].includes(body.mode)) throw new BadRequestException('测量操作类型无效，请重新读取原请求')
    let cartons: ReturnType<typeof computeCartonMeasures>
    try {
      if (!Array.isArray(body.cartons) || !body.cartons.length) throw Error('请至少录入 1 箱外箱尺寸')
      cartons = computeCartonMeasures(body.cartons)
    } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : '外箱资料无效') }
    const expectedRevision = String(body.expectedRevision || '').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(expectedRevision)) throw new BadRequestException('缺少原退件版本，请重新读取退件后再提交')
    const fingerprint = createHash('sha256').update(JSON.stringify([id, body.mode, expectedRevision, cartons])).digest('hex')
    const receipt = await this.prisma.$transaction(async tx => {
      // Serialize receipt lookup and close against delayed submissions from the same actor.
      await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(userId)} FOR UPDATE`
      const previous = await tx.operationLog.findFirst({ where: { module: 'returns', operatorId: BigInt(userId), detail: { path: '$.clientRequestId', equals: clientRequestId } }, select: { detail: true } })
      if (previous) {
        const detail = previous.detail as { requestFingerprint?: string; result?: MeasureFeesReceipt } | null
        if (detail?.requestFingerprint !== fingerprint || !detail.result || detail.result.id !== id || !['applied', 'closed'].includes(detail.result.outcome)) throw new ConflictException('原测量请求的内容或单号已变化，请核对原请求，不要重新提交')
        return { ...detail.result, duplicate: true }
      }
      await tx.$queryRaw`SELECT id FROM return_order WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.returnOrder.findUnique({ where: { id: BigInt(id) }, include: { cartons: { orderBy: { cartonNo: 'asc' } } } })
      let result: MeasureFeesReceipt
      if (closeOnly) {
        result = { outcome: 'closed', id, returnNo: row?.returnNo || String(id), estimatedFeeTotal: null }
      } else {
        if (!row) throw new NotFoundException('退件单不存在')
        if (await this.measurementVersion(tx, row) !== expectedRevision) throw new ConflictException('退件记录已变化，请先核对并结束原请求，再读取最新退件')
        if (body.mode === 'existing') {
          const current = computeCartonMeasures(row.cartons.map(c => ({ lengthCm: Number(c.lengthCm), widthCm: Number(c.widthCm), heightCm: Number(c.heightCm), grossWeightKg: Number(c.grossWeightKg) })))
          if (JSON.stringify(current) !== JSON.stringify(cartons)) throw new ConflictException('测量记录已变化，请先核对并结束原请求，再读取最新退件')
        } else {
          await this.measureInTransaction(tx, id, { cartons }, userId)
        }
        const updated = await this.calculateFeesInTransaction(tx, id, userId)
        result = { outcome: 'applied', id, returnNo: updated.returnNo, estimatedFeeTotal: Number(updated.estimatedFeeTotal || 0), customerId: Number(updated.customerId) }
      }
      await this.opLog.log({ module: 'returns', action: 'return_measure_fees_request', targetType: 'return_order', targetId: result.returnNo, operatorId: userId, detail: { clientRequestId, requestFingerprint: fingerprint, mode: body.mode, result } }, tx)
      return { ...result, duplicate: false }
    }, { isolationLevel: 'ReadCommitted', timeout: 20000 })
    if (receipt.outcome === 'applied' && !receipt.duplicate) {
      void this.pushReturnStatusToOms(receipt.returnNo)
      if (receipt.customerId) void this.billing.pushCustomerBillingToOms(receipt.customerId)
    }
    return receipt
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

    return this.prisma.$transaction(async tx => {
      // Serialize warehouse assignment changes across all template editors.
      await tx.$queryRaw`SELECT id FROM return_fee_template ORDER BY id FOR UPDATE`
      const exists = await tx.returnFeeTemplate.findFirst({
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

      const inactive = await tx.returnFeeTemplate.findFirst({
        where: { status: 'inactive', warehouseCode: wh },
      })
      if (inactive) {
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
        const revived = await tx.returnFeeTemplate.update({
            where: { id: inactive.id },
            data: { templateName, status: 'active', customerId: null },
            include: { rules: { orderBy: { sortOrder: 'asc' } } },
          })
        await this.logReturn({
          module: 'returns',
          action: 'return_fee_template_create',
          targetType: 'return_fee_template',
          targetId: inactive.templateCode,
          operatorId: userId,
          detail: { warehouseCode: wh, ruleCount: normalizedRules.length, revived: true },
        }, tx)
        return this.mapFeeTemplate(revived)
      }

      const templateCode = `wh_${wh.toLowerCase()}`

      const created = await tx.returnFeeTemplate.create({
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

      await this.logReturn({
        module: 'returns',
        action: 'return_fee_template_create',
        targetType: 'return_fee_template',
        targetId: templateCode,
        operatorId: userId,
        detail: { warehouseCode: wh, ruleCount: normalizedRules.length },
      }, tx)

      return this.mapFeeTemplate(created)
    }, { isolationLevel: 'ReadCommitted' })
  }

  async deleteFeeTemplate(id: number, userId: number) {
    return this.prisma.$transaction(async tx => {
      // Serialize warehouse assignment changes across all template editors.
      await tx.$queryRaw`SELECT id FROM return_fee_template ORDER BY id FOR UPDATE`
      const row = await tx.returnFeeTemplate.findUnique({ where: { id: BigInt(id) } })
      if (!row || row.status !== 'active') throw new NotFoundException('收费模板不存在')

      await tx.returnFeeTemplate.update({
        where: { id: row.id },
        data: { status: 'inactive' },
      })

      await this.logReturn({
        module: 'returns',
        action: 'return_fee_template_delete',
        targetType: 'return_fee_template',
        targetId: row.templateCode,
        operatorId: userId,
        detail: { warehouseCode: row.warehouseCode },
      }, tx)

      return { ok: true }
    }, { isolationLevel: 'ReadCommitted' })
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

  private async calculateFeesInTransaction(tx: Prisma.TransactionClient, id: number, userId: number,
    _body?: { clientRequestId?: string; extraLines?: { description?: string; amount?: number; quantity?: number; unitPrice?: number }[] },
  ) {
    const intent = this.returnActionIntent('return_calc_fee', id, userId, _body || {})
    if (intent) await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(userId)} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM return_order WHERE id = ${BigInt(id)} FOR UPDATE`
    const row = await tx.returnOrder.findUnique({
      where: { id: BigInt(id) },
      include: { items: true, cartons: { orderBy: { cartonNo: 'asc' } } },
    })
    if (!row) throw new NotFoundException('退件单不存在')
    if (await this.hasReturnActionReceipt(tx, userId, intent)) return tx.returnOrder.findUniqueOrThrow({ where: { id: BigInt(id) }, include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } } })
    if (row.status !== 'measured') {
      throw new BadRequestException('请先完成外箱体积测量，再生成费用')
    }
    if (!row.cartons.length) {
      throw new BadRequestException('缺少外箱测量数据')
    }

    const totalVolumeCbm = Number(row.totalVolumeCbm || 0)
    const template = await this.resolveWarehouseFeeTemplate(row.returnWarehouse, tx as PrismaService)
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

    await tx.$queryRaw`SELECT id FROM customer WHERE id = ${row.customerId} FOR UPDATE`
    const charges = new ReturnsChargeService(tx as PrismaService, this.billing)
    await charges.clearPendingAutoReturnCharges(row.returnNo)
    await charges.clearPendingManualExtraCharges(row.returnNo)
    for (const line of autoLines) {
      await charges.createReturnCharge({
        customerId: Number(row.customerId),
        returnNo: row.returnNo,
        warehouseCode: row.returnWarehouse || undefined,
        source: 'wms',
        ...line,
      }, false)
    }

    const updated = await tx.returnOrder.update({
      where: { id: row.id },
      data: {
        status: 'fee_calculated',
        feeCalculatedAt: new Date(),
        estimatedFeeTotal,
        feeStatus: 'estimated',
      },
      include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
    })

    await this.logReturn({
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
    }, tx, intent)
    return updated
  }

  async calculateFees(id: number, userId: number,
    _body?: { clientRequestId?: string; extraLines?: { description?: string; amount?: number; quantity?: number; unitPrice?: number }[] },
  ) {
    await this.ensureMissingWarehouseTemplates()
    const updated = await this.prisma.$transaction(tx => this.calculateFeesInTransaction(tx, id, userId, _body), { isolationLevel: 'ReadCommitted' })
    void this.billing.pushCustomerBillingToOms(Number(updated.customerId))
    void this.pushReturnStatusToOms(updated.returnNo)
    const loadedFeeLines = await this.returnCharges.loadFeeLines(updated.returnNo)
    return { ...this.enrichRow(updated), feeLines: loadedFeeLines }
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
    return this.prisma.$transaction(async tx => {
      // Serialize warehouse assignment changes across all template editors.
      await tx.$queryRaw`SELECT id FROM return_fee_template ORDER BY id FOR UPDATE`
      const row = await tx.returnFeeTemplate.findUnique({ where: { id: BigInt(id) } })
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
      const conflict = await tx.returnFeeTemplate.findFirst({
        where: { status: 'active', warehouseCode: wh, id: { not: row.id } },
      })
      if (conflict) throw new BadRequestException(`${wh} 仓库已有其他收费模板`)

      const customerId = null as bigint | null

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
      const updated = await tx.returnFeeTemplate.update({
          where: { id: row.id },
          data: {
            templateName,
            warehouseCode: wh,
            customerId,
          },
          include: { rules: { orderBy: { sortOrder: 'asc' } } },
        })

      await this.logReturn({
        module: 'returns',
        action: 'return_fee_template_update',
        targetType: 'return_fee_template',
        targetId: row.templateCode,
        operatorId: userId,
        detail: { templateName, ruleCount: normalizedRules.length },
      }, tx)

      return this.mapFeeTemplate(updated)
    }, { isolationLevel: 'ReadCommitted' })
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
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM return_fee_template ORDER BY id FOR UPDATE`
      for (const wh of RETURN_WAREHOUSES) {
        const exists = await tx.returnFeeTemplate.findFirst({
          where: { warehouseCode: wh },
        })
        if (exists) continue
        const rules = defaultMeasureFeeRules(wh)
        await tx.returnFeeTemplate.upsert({
          where: { templateCode: `wh_${wh.toLowerCase()}` },
          update: {},
          create: {
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
    }, { isolationLevel: 'ReadCommitted' })
  }

  private async resolveWarehouseFeeTemplate(warehouseCode: string | null, client: PrismaService = this.prisma) {
    const wh = normalizeReturnWarehouse(warehouseCode)
    if (!wh) {
      throw new BadRequestException('退件单缺少有效退件仓库，无法匹配收费模板')
    }
    if (client === this.prisma) await this.ensureMissingWarehouseTemplates()
    const row = await client.returnFeeTemplate.findFirst({
      where: { status: 'active', warehouseCode: wh },
      include: { rules: { where: { autoApply: true }, orderBy: { sortOrder: 'asc' } } },
    })
    if (!row?.rules?.length) {
      throw new BadRequestException(`${wh} 仓库尚未配置退件收费模板，请先在「收费模板」中创建`)
    }
    return row
  }

  async submitInspection(
    id: number,
    body: { clientRequestId?: string;
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
    const written: string[] = []
    const updated = await this.prisma.$transaction(async tx => {
      const intent = this.returnActionIntent('return_inspect', id, userId, body)
      if (intent) await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(userId)} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM return_order WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.returnOrder.findUnique({
        where: { id: BigInt(id) },
        include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
      })
      if (!row) throw new NotFoundException('退件单不存在')
      if (await this.hasReturnActionReceipt(tx, userId, intent)) return tx.returnOrder.findUniqueOrThrow({ where: { id: BigInt(id) }, include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } } })
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

      for (const att of normalized) {
        const saved = this.writeAttachment(att.fileName, att.contentBase64)
        written.push(saved.filePath)
        await tx.returnAttachment.create({
          data: {
            returnId: row.id,
            fileType: 'inspection_photo',
            fileName: saved.fileName,
            filePath: saved.filePath,
          },
        })
      }
      const updated = await tx.returnOrder.update({
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

      await this.logReturn({
        module: 'returns',
        action: 'return_inspect',
        targetType: 'return_order',
        targetId: row.returnNo,
        operatorId: userId,
        detail: { inspectionResult, photoCount: normalized.length },
      }, tx, intent)
      return updated
    }, { isolationLevel: 'ReadCommitted' }).catch(error => {
      for (const path of written) this.files.remove(path)
      throw error
    })
    void this.pushReturnStatusToOms(updated.returnNo)
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
      throw new BadRequestException('请选择留货或不留货的处理决定')
    }

    const updated = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM return_order WHERE return_no = ${no} FOR UPDATE`
      const row = await tx.returnOrder.findUnique({
        where: { returnNo: no },
        include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
      })
      if (!row) throw new NotFoundException(`退件单 ${no} 不存在`)
      const code = body.customerCode?.trim()
      if (!code) throw new BadRequestException('缺少客户代码')
      if (!row.omsCustomerCode || row.omsCustomerCode !== code) {
        throw new BadRequestException('客户编码与退件单不匹配')
      }
      if (row.status !== 'awaiting_customer') {
        throw new BadRequestException('当前状态不可确认，仅「待客户确认」可操作')
      }

      const totalQty = row.receivedQty ?? row.items.reduce((s, i) => s + i.quantity, 0)
      const totalVolumeCbm = Number(row.totalVolumeCbm || 0)

      await tx.$queryRaw`SELECT id FROM customer WHERE id = ${row.customerId} FOR UPDATE`
      const charges = new ReturnsChargeService(tx as PrismaService, this.billing)
      await charges.clearPendingDecisionCharges(no)

      let nextStatus: string
      let customerProcessChoice: string | null = null

      if (decision === 'discard') {
        nextStatus = 'dispose_pending'
        const feeLines = buildDiscardFeeLines(totalVolumeCbm)
        for (const line of feeLines) {
          await charges.createReturnCharge({
            customerId: Number(row.customerId),
            returnNo: no,
            warehouseCode: row.returnWarehouse || undefined,
            ...line,
          }, false)
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
          await charges.createReturnCharge({
            customerId: Number(row.customerId),
            returnNo: no,
            warehouseCode: row.returnWarehouse || undefined,
            ...line,
          }, false)
        }
      }

      const estimatedFeeTotal = await charges.refreshEstimatedFeeTotal(row.id, no)

      const updated = await tx.returnOrder.update({
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

      await this.logReturn({
        module: 'returns',
        action: 'return_customer_decide',
        targetType: 'return_order',
        targetId: no,
        detail: { decision, processChoice: customerProcessChoice, estimatedFeeTotal },
      }, tx)
      return updated
    }, { isolationLevel: 'ReadCommitted' })
    void this.billing.pushCustomerBillingToOms(Number(updated.customerId))
    void this.pushReturnStatusToOms(no)
    return { ...this.mapReturnForOms(updated), idempotent: false }
  }

  async executeDispose(id: number, body: { clientRequestId?: string; processRemark?: string }, userId: number) {
    const updated = await this.prisma.$transaction(async tx => {
      const intent = this.returnActionIntent('return_dispose', id, userId, body)
      if (intent) await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(userId)} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM return_order WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.returnOrder.findUnique({ where: { id: BigInt(id) } })
      if (!row) throw new NotFoundException('退件单不存在')
      if (await this.hasReturnActionReceipt(tx, userId, intent)) return tx.returnOrder.findUniqueOrThrow({ where: { id: BigInt(id) }, include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } } })
      if (row.status !== 'dispose_pending') {
        throw new BadRequestException('当前状态不可销毁，仅「待销毁」可确认')
      }
      const updated = await tx.returnOrder.update({
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
      await this.logReturn({
        module: 'returns',
        action: 'return_dispose',
        targetType: 'return_order',
        targetId: row.returnNo,
        operatorId: userId,
      }, tx, intent)
      return updated
    }, { isolationLevel: 'ReadCommitted' })
    void this.pushReturnStatusToOms(updated.returnNo)
    return this.enrichRow(updated)
  }

  private async withRestockProgress<T extends { returnNo: string; receivedQty: number | null; items: { sku: string; quantity: number }[] }>(rows: T[]) {
    if (!rows.length) return []
    const logs = await this.prisma.inventoryLog.findMany({ where: { changeType: 'return_restock', referenceNo: { in: rows.map(row => row.returnNo) } }, select: { referenceNo: true, sku: true, changeQty: true } })
    return rows.map(row => {
      const progress = returnRestockProgress(row, logs)
      return { ...row, ...progress, items: row.items.map(item => ({ ...item, restockedQty: progress.restockedBySku[item.sku] || 0 })) }
    })
  }

  async process(id: number, body: ReturnProcessInput, userId: number) {
    const clientRequestId = String(body.clientRequestId || '').trim()
    if (clientRequestId.length > 100) throw new BadRequestException('操作标识过长，请关闭弹窗后重新操作')
    const result = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM return_order WHERE id = ${BigInt(id)} FOR UPDATE`
      const row = await tx.returnOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true } })
      if (!row) throw new NotFoundException('退件单不存在')
      const processResult = String(body.processResult || row.customerProcessChoice || row.requestedProcess || '').trim()
      if (!isValidProcessMethod(processResult) || processResult === 'destroy') throw new BadRequestException('请选择有效的处理结果')
      const fingerprint = returnProcessFingerprint(body, processResult)
      if (clientRequestId) {
        const closed = await tx.operationLog.findFirst({ where: { module: 'returns', action: 'warehouse_request_closed', targetId: row.returnNo, operatorId: BigInt(userId), detail: { path: '$.clientRequestId', equals: clientRequestId } } })
        if (closed) throw new ConflictException('原退件处理已核对结束，请刷新单据后重新操作')
        const previous = await tx.operationLog.findFirst({ where: { module: 'returns', action: 'process', targetId: row.returnNo, detail: { path: '$.clientRequestId', equals: clientRequestId } }, select: { detail: true } })
        if (previous) {
          if ((previous.detail as { requestFingerprint?: string } | null)?.requestFingerprint !== fingerprint) throw new ConflictException('同一次操作的内容已变化，请刷新退件记录核对后再继续')
          await this.returnSync.enqueue(tx, row.returnNo, ['restock', 'relabel'].includes(processResult) ? String(body.warehouseCode || '').trim() : undefined)
          return { duplicate: true, returnNo: row.returnNo, needsStock: ['restock', 'relabel'].includes(processResult), warehouseCode: String(body.warehouseCode || '').trim() }
        }
      }
      if (!['accepted_pending', 'arrived', 'processing'].includes(row.status)) throw new BadRequestException('请先完成质检与客户确认，或当前状态不可处理')
      if (row.status === 'accepted_pending' && row.customerProcessChoice && row.customerProcessChoice !== processResult) {
        throw new BadRequestException(`客户确认的处理方式为${processMethodLabel(row.customerProcessChoice)}，请按客户确认结果执行`)
      }
      const needsStock = processResult === 'restock' || processResult === 'relabel'
      if (needsStock && !clientRequestId) throw new BadRequestException('缺少本次上架操作标识，请刷新退件页面后再操作')
      const stock = needsStock ? await restockReturnToLocations(tx, row, body, this.inventoryMutation, userId) : undefined
      const completed = !stock || stock.remainingRestockQty === 0
      await tx.returnOrder.update({ where: { id: row.id }, data: {
        status: completed ? 'completed' : row.status, processResult,
        processRemark: body.processRemark?.trim() || row.processRemark || undefined,
        processedAt: completed ? new Date() : null, processedBy: BigInt(userId),
      } })
      await tx.operationLog.create({ data: {
        module: 'returns', action: 'process', targetType: 'return_order', targetId: row.returnNo, operatorId: BigInt(userId),
        detail: { processResult, processRemark: body.processRemark || null, clientRequestId: clientRequestId || null,
          requestFingerprint: fingerprint, ...(stock ? { warehouseCode: body.warehouseCode, ...stock } : {}) },
      } })
      await this.returnSync.enqueue(tx, row.returnNo, needsStock ? String(body.warehouseCode || '').trim() : undefined)
      return { duplicate: false, returnNo: row.returnNo, needsStock, warehouseCode: String(body.warehouseCode || '').trim() }
    }, { timeout: 20000 })
    const statusPushed = await this.pushReturnStatusToOms(result.returnNo)
    const inventoryPushed = true // The durable task includes inventory publication when required.
    return { ...(await this.detail(id)), duplicate: result.duplicate,
      ...(!statusPushed || !inventoryPushed ? { warning: '处理结果已保存，但 OMS 同步未完成，请在 OMS 刷新核对，请勿重复入库。' } : {}) }
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
    const updated = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM return_order WHERE return_no = ${no} FOR UPDATE`
      const row = await tx.returnOrder.findUnique({
        where: { returnNo: no },
        include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
      })
      if (!row) throw new NotFoundException(`退件单 ${no} 不存在`)
      const code = String(customerCode || '').trim()
      if (!code) throw new BadRequestException('缺少客户代码')
      if (!row.omsCustomerCode || row.omsCustomerCode !== code) {
        throw new BadRequestException('客户编码与退件单不匹配')
      }
      if (row.status === 'cancelled') {
        await this.returnSync.enqueue(tx, no)
        return { row, idempotent: true }
      }
      if (row.status !== 'pending_arrival') {
        throw new BadRequestException('当前状态不可撤回，仅「待到货」可撤回')
      }
      const updated = await tx.returnOrder.update({
        where: { id: row.id },
        data: { status: 'cancelled' },
        include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
      })
      await this.logReturn({
        module: 'returns',
        action: 'oms_return_cancel',
        targetType: 'return_order',
        targetId: no,
        detail: { customerCode: row.omsCustomerCode },
      }, tx)
      return { row: updated, idempotent: false }
    }, { isolationLevel: 'ReadCommitted' })
    void this.pushReturnStatusToOms(no)
    return { ...this.mapReturnForOms(updated.row), idempotent: updated.idempotent }
  }

  async downloadAttachmentByReturnNo(returnNo: string, attachmentId: number, customerCode: string) {
    const no = returnNo.trim()
    const code = String(customerCode || '').trim()
    if (!code) throw new BadRequestException('缺少客户代码')
    const row = await this.prisma.returnOrder.findUnique({ where: { returnNo: no } })
    if (!row) throw new NotFoundException(`退件单 ${no} 不存在`)
    if (!row.omsCustomerCode || row.omsCustomerCode !== code) {
      throw new BadRequestException('客户编码与退件单不匹配')
    }
    return this.downloadAttachment(Number(row.id), attachmentId)
  }

  private async pushReturnStatusToOms(returnNo: string) {
    return this.returnSync.flush(returnNo)
  }

  private async sendReturnStatusToOms(returnNo: string) {
    try {
      const row = await this.prisma.returnOrder.findUnique({
        where: { returnNo },
        include: { items: true, attachments: { orderBy: { id: 'asc' } }, cartons: { orderBy: { cartonNo: 'asc' } } },
      })
      if (!row?.omsCustomerCode) return true
      return await notifyOms('return.status', row.omsCustomerCode, this.mapReturnForOms(row) as Record<string, unknown>)
    } catch (err) {
      console.warn('[returns] push OMS skipped:', err)
      return false
    }
  }

  private async pushReturnStockToOms(id: number, warehouseCode: string) {
    try {
      const order = await this.prisma.returnOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true } })
      if (!order?.omsCustomerCode || !warehouseCode) return true
      const skus = [...new Set(order.items.map(item => item.sku))]
      const stock = await this.prisma.inventory.findMany({ where: { warehouseCode, sku: { in: skus } }, select: { sku: true, availableQty: true, lockedQty: true } })
      const holdings = await this.prisma.customerSkuInventory.findMany({ where: { customerId: order.customerId, sku: { in: skus.filter(isCatalogInternalSku) } }, select: { sku: true, quantity: true } })
      const results: boolean[] = []
      const owned = stock.filter(line => !isCatalogInternalSku(line.sku))
      if (owned.length) results.push(await notifyOms('inventory.changed', order.omsCustomerCode, { reason: 'return_restock', stockSource: 'owned', warehouseCode, items: owned }))
      if (holdings.length) results.push(await notifyOms('inventory.changed', order.omsCustomerCode, { reason: 'return_restock', stockSource: 'catalog', warehouseCode, items: holdings.map(line => ({ sku: line.sku, holdingQty: line.quantity })) }))
      return results.every(Boolean)
    } catch (error) { console.warn('[returns] push inventory skipped:', error); return false }
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
