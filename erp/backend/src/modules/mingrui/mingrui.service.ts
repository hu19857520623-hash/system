import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { getPagination } from '../../common/dto/pagination.dto'
import { MingruiClient } from './mingrui.client'
import type { CreateMingruiShipmentDto, MingruiListQueryDto, SyncMingruiQueryDto, UpdateMingruiShipmentDto } from './mingrui.dto'

const BOOKABLE_PO_STATUSES = ['finance_approved', 'at_logistics_wh', 'received', 'completed', 'approved']
const ACTIVE_SHIPMENT_STATUSES = ['draft', 'submitted', 'booked', 'in_transit']

function num(v: { toNumber?: () => number } | number | null | undefined): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v.toNumber === 'function') return v.toNumber()
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function parseDate(value?: string) {
  if (!value) return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function textFrom(value: unknown): string | undefined {
  if (value == null) return undefined
  const normalized = String(value).trim()
  return normalized || undefined
}

@Injectable()
export class MingruiService {
  private readonly client: MingruiClient

  constructor(
    private prisma: PrismaService,
    config: ConfigService,
  ) {
    this.client = new MingruiClient(config)
  }

  apiMeta() {
    const configured = this.client.isConfigured()
    return {
      configured,
      queryConfigured: configured,
      bookingConfigured: false,
      base: this.client.apiBase() || null,
      message: configured
        ? '已接入明瑞 AI-OPS 物流查询（跟踪状态 / 订单信息）。下单接口尚未提供，请保存草稿并填写明瑞工作号后同步。'
        : '明瑞查询接口已接通，但未配置认证密钥。请在 erp/backend/.env 填写 MINGRUI_APP_KEY、MINGRUI_APP_TOKEN 后重启后端。',
    }
  }

  async list(q: MingruiListQueryDto) {
    const { page, pageSize } = getPagination(q)
    const where: Prisma.MingruiShipmentWhereInput = {}
    if (q.status) where.status = q.status
    if (q.keyword) {
      where.OR = [
        { shipmentNo: { contains: q.keyword } },
        { poNos: { contains: q.keyword } },
        { mingruiOrderNo: { contains: q.keyword } },
        { blNo: { contains: q.keyword } },
        { containerNo: { contains: q.keyword } },
      ]
    }
    const [rows, total] = await Promise.all([
      this.prisma.mingruiShipment.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'desc' },
      }),
      this.prisma.mingruiShipment.count({ where }),
    ])
    return {
      items: rows.map((row) => this.serialize(row)),
      total,
      page,
      pageSize,
      api: this.apiMeta(),
    }
  }

  async detail(id: number) {
    const row = await this.prisma.mingruiShipment.findUnique({ where: { id } })
    if (!row) throw new NotFoundException('明瑞运单不存在')
    return this.serialize(row)
  }

  async eligiblePos() {
    const [pos, shipments] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where: { status: { in: BOOKABLE_PO_STATUSES } },
        include: { items: true },
        orderBy: { id: 'desc' },
        take: 200,
      }),
      this.prisma.mingruiShipment.findMany({
        where: { status: { in: ACTIVE_SHIPMENT_STATUSES } },
        select: { poNos: true, shipmentNo: true, status: true },
      }),
    ])

    const booked = new Map<string, { shipmentNo: string; status: string }>()
    for (const s of shipments) {
      for (const poNo of String(s.poNos || '')
        .split(/[,，\s]+/)
        .map((x) => x.trim())
        .filter(Boolean)) {
        booked.set(poNo, { shipmentNo: s.shipmentNo, status: s.status })
      }
    }

    const supplierIds = [...new Set(pos.map((p) => Number(p.supplierId)).filter(Boolean))]
    const suppliers = supplierIds.length
      ? await this.prisma.supplier.findMany({
          where: { id: { in: supplierIds.map((id) => BigInt(id)) } },
          select: { id: true, supplierName: true },
        })
      : []
    const supMap = new Map(suppliers.map((s) => [Number(s.id), s.supplierName]))

    return pos.map((po) => {
      const link = booked.get(po.poNo)
      const items = po.items || []
      return {
        id: Number(po.id),
        poNo: po.poNo,
        supplierName: supMap.get(Number(po.supplierId)) || '—',
        warehouseCode: po.warehouseCode,
        status: po.status,
        paymentStatus: po.paymentStatus,
        skuLabel: items.map((i) => i.sku).filter(Boolean).join(' / ') || '—',
        productName: items[0]?.productName || '—',
        qty: items.reduce((sum, i) => sum + (i.quantity || 0), 0),
        booked: Boolean(link),
        bookedShipmentNo: link?.shipmentNo || null,
      }
    })
  }

  async create(body: CreateMingruiShipmentDto, userId: number) {
    const poMeta = await this.resolvePos(body.poIds, body.poNos)
    const shipmentNo = await this.nextShipmentNo()
    const row = await this.prisma.mingruiShipment.create({
      data: {
        shipmentNo,
        status: 'draft',
        mode: body.mode || 'lcl',
        poNos: poMeta.poNos,
        poRefs: poMeta.poRefs as Prisma.InputJsonValue,
        cargoItems: poMeta.cargoItems as Prisma.InputJsonValue,
        destWarehouse: body.destWarehouse,
        originCity: body.originCity || '深圳',
        destPort: body.destPort || 'Durban',
        packages: body.packages ?? poMeta.packages,
        weightKg: body.weightKg,
        volumeCbm: body.volumeCbm,
        freightAmount: body.freightAmount,
        etd: parseDate(body.etd),
        eta: parseDate(body.eta),
        remark: body.remark,
        mingruiOrderNo: body.mingruiOrderNo,
        apiPayload: body.trackingRef ? { trackingRef: body.trackingRef } : undefined,
        apiStatus: this.client.isConfigured() ? 'pending' : 'not_configured',
        createdBy: BigInt(userId),
      },
    })
    if (body.submit) return this.submit(Number(row.id))
    return this.serialize(row)
  }

  async update(id: number, body: UpdateMingruiShipmentDto) {
    const row = await this.prisma.mingruiShipment.findUnique({ where: { id } })
    if (!row) throw new NotFoundException('明瑞运单不存在')
    if (row.status !== 'draft') {
      throw new BadRequestException('仅草稿可修改，已下单请在明瑞物流信息中同步')
    }
    const updated = await this.prisma.mingruiShipment.update({
      where: { id },
      data: {
        mode: body.mode,
        destWarehouse: body.destWarehouse,
        originCity: body.originCity,
        destPort: body.destPort,
        packages: body.packages,
        weightKg: body.weightKg,
        volumeCbm: body.volumeCbm,
        freightAmount: body.freightAmount,
        etd: parseDate(body.etd),
        eta: parseDate(body.eta),
        vesselName: body.vesselName,
        blNo: body.blNo,
        containerNo: body.containerNo,
        remark: body.remark,
      },
    })
    return this.serialize(updated)
  }

  async submit(id: number) {
    const row = await this.prisma.mingruiShipment.findUnique({ where: { id } })
    if (!row) throw new NotFoundException('明瑞运单不存在')
    if (row.status === 'cancelled') throw new BadRequestException('已取消的运单不能下单')
    if (!['draft', 'submitted'].includes(row.status)) {
      throw new BadRequestException('当前状态不可再次下单')
    }

    const result = await this.client.createBooking({
      shipmentNo: row.shipmentNo,
      mode: row.mode,
      destWarehouse: row.destWarehouse,
      originCity: row.originCity,
      destPort: row.destPort,
      packages: row.packages,
      weightKg: num(row.weightKg),
      volumeCbm: num(row.volumeCbm),
      poNos: row.poNos,
      cargoItems: row.cargoItems,
      remark: row.remark,
    })
    if (!result.ok) {
      throw new BadRequestException(result.message || '明瑞物流尚未接通，无法提交下单')
    }

    const updated = await this.prisma.mingruiShipment.update({
      where: { id },
      data: {
        status: result.ok ? 'booked' : 'submitted',
        apiStatus: result.configured ? (result.ok ? 'synced' : 'pending') : 'not_configured',
        mingruiOrderNo: result.mingruiOrderNo || row.mingruiOrderNo,
        trackingStatus: result.trackingStatus || row.trackingStatus || (result.ok ? 'booked' : 'pending_api'),
        trackingDetail: result.trackingDetail || row.trackingDetail || result.message,
        lastSyncAt: new Date(),
        lastSyncError: result.ok ? null : result.message,
        apiPayload: result.raw as Prisma.InputJsonValue,
      },
    })
    return { ...this.serialize(updated), apiResult: result }
  }

  async sync(id: number, query: SyncMingruiQueryDto = {}) {
    const row = await this.prisma.mingruiShipment.findUnique({ where: { id } })
    if (!row) throw new NotFoundException('明瑞运单不存在')
    const previous = asRecord(row.apiPayload)
    const jobNum = query.jobNum || row.mingruiOrderNo
    const trackingRef = query.trackingRef
      || textFrom(previous?.trackingRef)
      || textFrom(asRecord(previous?.tracking)?.trackingRef)
      || textFrom(asRecord(previous?.shipment)?.trackingRef)
    const result = await this.client.queryTracking({
      mingruiOrderNo: jobNum,
      trackingRef,
      blNo: row.blNo,
      shipmentNo: row.shipmentNo,
    })
    if (!result.ok && result.configured && !jobNum && !trackingRef) {
      throw new BadRequestException(result.message)
    }
    const updated = await this.prisma.mingruiShipment.update({
      where: { id },
      data: {
        apiStatus: result.configured ? (result.ok ? 'synced' : 'error') : 'not_configured',
        mingruiOrderNo: result.mingruiOrderNo || jobNum || row.mingruiOrderNo,
        trackingStatus: result.trackingStatus || row.trackingStatus,
        trackingDetail: result.trackingDetail || result.message,
        blNo: result.blNo || row.blNo,
        containerNo: result.containerNo || row.containerNo,
        vesselName: result.vesselName || row.vesselName,
        originCity: result.originCity || row.originCity,
        destPort: result.destPort || row.destPort,
        packages: result.packages ?? row.packages,
        weightKg: result.weightKg ?? row.weightKg,
        volumeCbm: result.volumeCbm ?? row.volumeCbm,
        etd: parseDate(result.etd) || row.etd,
        eta: parseDate(result.eta) || row.eta,
        lastSyncAt: new Date(),
        lastSyncError: result.ok ? null : result.message,
        apiPayload: {
          trackingRef: result.trackingRef || trackingRef || null,
          tracking: result.raw && typeof result.raw === 'object' ? (result.raw as { tracking?: unknown }).tracking : null,
          shipment: result.raw && typeof result.raw === 'object' ? (result.raw as { shipment?: unknown }).shipment : null,
          nodes: result.trackingNodes || [],
        } as Prisma.InputJsonValue,
        status: result.localStatus === 'arrived'
          ? 'arrived'
          : result.localStatus === 'in_transit'
            ? 'in_transit'
            : result.localStatus === 'booked' && row.status === 'draft'
              ? 'booked'
              : row.status,
      },
    })
    return { ...this.serialize(updated), apiResult: result }
  }

  async cancel(id: number) {
    const row = await this.prisma.mingruiShipment.findUnique({ where: { id } })
    if (!row) throw new NotFoundException('明瑞运单不存在')
    if (['arrived', 'cancelled'].includes(row.status)) {
      throw new BadRequestException('当前状态不可取消')
    }
    const updated = await this.prisma.mingruiShipment.update({
      where: { id },
      data: { status: 'cancelled', trackingStatus: 'cancelled' },
    })
    return this.serialize(updated)
  }

  private async nextShipmentNo() {
    const now = new Date()
    const prefix = `MR${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    const count = await this.prisma.mingruiShipment.count({
      where: { shipmentNo: { startsWith: prefix } },
    })
    return `${prefix}${String(count + 1).padStart(3, '0')}`
  }

  private async resolvePos(poIds?: number[], poNosText?: string) {
    const ids = (poIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
    const nos = String(poNosText || '')
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)

    if (!ids.length && !nos.length) {
      return { poNos: null as string | null, poRefs: [], cargoItems: [], packages: 0 }
    }

    const pos = await this.prisma.purchaseOrder.findMany({
      where: {
        OR: [
          ...(ids.length ? [{ id: { in: ids.map((id) => BigInt(id)) } }] : []),
          ...(nos.length ? [{ poNo: { in: nos } }] : []),
        ],
      },
      include: { items: true },
    })
    if (!pos.length) throw new BadRequestException('未找到关联采购单')

    const poRefs = pos.map((po) => ({
      poId: Number(po.id),
      poNo: po.poNo,
      warehouseCode: po.warehouseCode,
    }))
    const cargoItems = pos.flatMap((po) =>
      (po.items || []).map((item) => ({
        poNo: po.poNo,
        sku: item.sku,
        productName: item.productName,
        qty: item.quantity,
      })),
    )
    return {
      poNos: pos.map((p) => p.poNo).join(','),
      poRefs,
      cargoItems,
      packages: cargoItems.reduce((sum, i) => sum + (i.qty || 0), 0),
    }
  }

  private serialize(row: {
    id: bigint
    shipmentNo: string
    status: string
    mode: string
    poNos: string | null
    poRefs: Prisma.JsonValue | null
    inboundNo: string | null
    destWarehouse: string | null
    originCity: string | null
    destPort: string | null
    packages: number | null
    weightKg: Prisma.Decimal | number | null
    volumeCbm: Prisma.Decimal | number | null
    freightAmount: Prisma.Decimal | number | null
    etd: Date | null
    eta: Date | null
    vesselName: string | null
    blNo: string | null
    containerNo: string | null
    mingruiOrderNo: string | null
    trackingStatus: string | null
    trackingDetail: string | null
    cargoItems: Prisma.JsonValue | null
    apiStatus: string
    apiPayload: Prisma.JsonValue | null
    lastSyncAt: Date | null
    lastSyncError: string | null
    remark: string | null
    createdBy: bigint | null
    createdAt: Date
    updatedAt: Date
  }) {
    const payload = asRecord(row.apiPayload)
    const trackingNodes = Array.isArray(payload?.nodes)
      ? payload.nodes
      : Array.isArray(asRecord(payload?.tracking)?.nodes)
        ? asRecord(payload?.tracking)?.nodes
        : []
    const trackingRef = textFrom(payload?.trackingRef)
      || textFrom(asRecord(payload?.tracking)?.trackingRef)
      || textFrom(asRecord(payload?.shipment)?.trackingRef)
    const api = this.apiMeta()
    const logisticsInfo = {
      shipmentNo: row.shipmentNo,
      mingruiOrderNo: row.mingruiOrderNo,
      trackingRef: trackingRef || null,
      trackingStatus: row.trackingStatus,
      trackingDetail: row.trackingDetail,
      trackingNodes,
      blNo: row.blNo,
      containerNo: row.containerNo,
      vesselName: row.vesselName,
      etd: row.etd,
      eta: row.eta,
      destWarehouse: row.destWarehouse,
      destPort: row.destPort,
      originCity: row.originCity,
      lastSyncAt: row.lastSyncAt,
      lastSyncError: row.lastSyncError,
      apiStatus: row.apiStatus,
      apiConfigured: api.queryConfigured,
      apiMessage: row.lastSyncError || api.message,
    }
    return {
      id: Number(row.id),
      shipmentNo: row.shipmentNo,
      status: row.status,
      mode: row.mode,
      poNos: row.poNos,
      poRefs: row.poRefs,
      inboundNo: row.inboundNo,
      destWarehouse: row.destWarehouse,
      originCity: row.originCity,
      destPort: row.destPort,
      packages: row.packages,
      weightKg: num(row.weightKg),
      volumeCbm: num(row.volumeCbm),
      freightAmount: num(row.freightAmount),
      etd: row.etd,
      eta: row.eta,
      vesselName: row.vesselName,
      blNo: row.blNo,
      containerNo: row.containerNo,
      mingruiOrderNo: row.mingruiOrderNo,
      trackingRef: trackingRef || null,
      trackingStatus: row.trackingStatus,
      trackingDetail: row.trackingDetail,
      trackingNodes,
      cargoItems: row.cargoItems,
      apiStatus: row.apiStatus,
      lastSyncAt: row.lastSyncAt,
      lastSyncError: row.lastSyncError,
      remark: row.remark,
      createdBy: row.createdBy != null ? Number(row.createdBy) : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      logisticsInfo,
      api,
    }
  }
}
