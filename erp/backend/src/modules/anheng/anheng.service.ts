import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { FileStoreService } from '../../common/file-store.service'
import { PrismaService } from '../../common/prisma/prisma.service'
import { getPagination, type PageResult } from '../../common/dto/pagination.dto'
import {
  WCS_IMAGE_OK,
  WCS_SPEC_SAMPLE_WEIGH_BODY,
  asWcsString,
  buildWcsWeighReply,
  decodeJpegBase64,
  deviceKeyAccepted,
  extractPresentedDeviceKey,
  normalizeWcsWeighBody,
  previewWmsOutputs,
  validateWcsWeighItem,
  WCS_MEMBER_ID_MESSAGE,
  type WcsWeighReply,
} from './wcs-weigh.util'

const CONFIG_ID = 1
const PHOTO_DIR = 'wcs-photos'
const MAX_PHOTO_BYTES = 12 * 1024 * 1024

export type WcsCallContext = {
  deviceKey?: string
  queryKey?: unknown
  body?: unknown
  ip?: string
  source: 'device' | 'simulate'
}

@Injectable()
export class AnhengService {
  constructor(
    private prisma: PrismaService,
    private files: FileStoreService,
  ) {}

  async getConfig() {
    const existing = await this.prisma.wcsDeviceConfig.findUnique({ where: { id: CONFIG_ID } })
    if (existing) return this.serializeConfig(existing)
    const created = await this.prisma.wcsDeviceConfig.create({
      data: { id: CONFIG_ID, enabled: true, chuteMessage: '' },
    })
    return this.serializeConfig(created)
  }

  async saveConfig(body: {
    enabled?: boolean
    deviceKey?: string | null
    chuteMessage?: string
    requireMemberId?: boolean
    printData?: string | null
  }) {
    await this.getConfig()
    const updated = await this.prisma.wcsDeviceConfig.update({
      where: { id: CONFIG_ID },
      data: {
        enabled: body.enabled ?? undefined,
        deviceKey: body.deviceKey === undefined ? undefined : asWcsString(body.deviceKey) || null,
        chuteMessage: body.chuteMessage === undefined ? undefined : asWcsString(body.chuteMessage).slice(0, 80),
        requireMemberId: body.requireMemberId ?? undefined,
        printData: body.printData === undefined ? undefined : asWcsString(body.printData).slice(0, 2000) || null,
      },
    })
    return this.serializeConfig(updated)
  }

  async handleWeigh(body: unknown, ctx: WcsCallContext): Promise<WcsWeighReply> {
    const config = await this.loadConfigRow()
    if (ctx.source !== 'simulate') {
      const presented = extractPresentedDeviceKey({
        header: ctx.deviceKey,
        query: ctx.queryKey,
        body: ctx.body ?? body,
      })
      if (!deviceKeyAccepted(config.deviceKey, presented)) {
        return this.persistWeighFailure(body, ctx, 'device key invalid')
      }
      if (!config.enabled) {
        return this.persistWeighFailure(body, ctx, 'receiver disabled')
      }
    }

    const items = normalizeWcsWeighBody(body)
    if (!items.length) {
      return this.persistWeighFailure(body, ctx, 'empty payload')
    }

    const originals = Array.isArray(body) ? body : [body]
    let last: WcsWeighReply = buildWcsWeighReply({ ok: false, message: 'empty payload' })
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const invalid = validateWcsWeighItem(item)
      const ok = !invalid
      const message = invalid
        ? invalid
        : config.requireMemberId
          ? WCS_MEMBER_ID_MESSAGE
          : config.chuteMessage || ''
      last = buildWcsWeighReply({
        ok,
        message,
        printData: ok ? config.printData : null,
      })
      const raw = originals[i] && typeof originals[i] === 'object' ? originals[i] : item
      await this.prisma.wcsWeighEvent.create({
        data: {
          ticketsNum: item.ticketsNum.slice(0, 80),
          weightKg: item.weight.slice(0, 40),
          lengthMm: item.length.slice(0, 40),
          widthMm: item.width.slice(0, 40),
          heightMm: item.height.slice(0, 40),
          volumeMm3: item.volume.slice(0, 40),
          machine: item.machine.slice(0, 80),
          memberNo: item.memberno.slice(0, 80) || null,
          warehouse: item.warehouse.slice(0, 80) || null,
          goodsName: item.goodsname.slice(0, 200) || null,
          goodsNum: item.goodsnum.slice(0, 40) || null,
          expressName: item.expressname.slice(0, 80) || null,
          remarks: item.myremarks.slice(0, 500) || null,
          rawJson: raw as Prisma.InputJsonValue,
          result: last.result,
          message: last.message.slice(0, 200),
          source: ctx.source,
          clientIp: asWcsString(ctx.ip).slice(0, 64) || null,
        },
      })
    }
    return last
  }

  async handleImage(body: unknown, ctx: WcsCallContext): Promise<{ isOk: number }> {
    const config = await this.loadConfigRow()
    if (ctx.source !== 'simulate') {
      const presented = extractPresentedDeviceKey({
        header: ctx.deviceKey,
        query: ctx.queryKey,
        body,
      })
      if (!deviceKeyAccepted(config.deviceKey, presented) || !config.enabled) {
        return { isOk: 0 }
      }
    }

    const payload = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
    const expressNo = asWcsString(payload.expressNo ?? payload.expressno ?? payload.ticketsNum).slice(0, 80)
    if (!expressNo) return { isOk: 0 }

    const decoded = decodeJpegBase64(payload.file)
    if (decoded.error || decoded.buffer.length > MAX_PHOTO_BYTES) return { isOk: 0 }

    const fileName = `${Date.now()}-${expressNo.replace(/[^\w.-]/g, '_')}.jpg`
    const stored = this.files.write(PHOTO_DIR, fileName, decoded.buffer)
    await this.prisma.wcsWeighPhoto.create({
      data: {
        expressNo,
        filePath: stored.relativePath,
        fileSize: decoded.buffer.length,
        isOk: WCS_IMAGE_OK.isOk,
        source: ctx.source,
        clientIp: asWcsString(ctx.ip).slice(0, 64) || null,
      },
    })
    return { ...WCS_IMAGE_OK }
  }

  async listEvents(query: { page?: unknown; pageSize?: unknown; keyword?: string }): Promise<PageResult<unknown>> {
    const { page, pageSize } = getPagination(query)
    const keyword = asWcsString(query.keyword)
    const where: Prisma.WcsWeighEventWhereInput = keyword
      ? {
          OR: [
            { ticketsNum: { contains: keyword } },
            { machine: { contains: keyword } },
            { warehouse: { contains: keyword } },
            { goodsName: { contains: keyword } },
          ],
        }
      : {}
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.wcsWeighEvent.count({ where }),
      this.prisma.wcsWeighEvent.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    return {
      items: rows.map((row) => ({
        ...row,
        id: Number(row.id),
      })),
      total,
      page,
      pageSize,
    }
  }

  async listPhotos(query: { page?: unknown; pageSize?: unknown; keyword?: string }): Promise<PageResult<unknown>> {
    const { page, pageSize } = getPagination(query)
    const keyword = asWcsString(query.keyword)
    const where: Prisma.WcsWeighPhotoWhereInput = keyword ? { expressNo: { contains: keyword } } : {}
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.wcsWeighPhoto.count({ where }),
      this.prisma.wcsWeighPhoto.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    return {
      items: rows.map((row) => ({
        id: Number(row.id),
        expressNo: row.expressNo,
        fileSize: row.fileSize,
        isOk: row.isOk,
        source: row.source,
        clientIp: row.clientIp,
        createdAt: row.createdAt,
      })),
      total,
      page,
      pageSize,
    }
  }

  async readPhoto(id: number) {
    const row = await this.prisma.wcsWeighPhoto.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('照片不存在')
    return {
      fileName: `${row.expressNo}.jpg`,
      content: this.files.read(row.filePath),
    }
  }

  async clearTestData() {
    const photos = await this.prisma.wcsWeighPhoto.findMany({ select: { filePath: true } })
    const deletedEvents = await this.prisma.wcsWeighEvent.deleteMany()
    const deletedPhotos = await this.prisma.wcsWeighPhoto.deleteMany()
    return {
      deletedEvents: deletedEvents.count,
      deletedPhotos: deletedPhotos.count,
      leftoverFiles: photos.length,
    }
  }

  private async loadConfigRow() {
    const existing = await this.prisma.wcsDeviceConfig.findUnique({ where: { id: CONFIG_ID } })
    if (existing) return existing
    return this.prisma.wcsDeviceConfig.create({
      data: { id: CONFIG_ID, enabled: true, chuteMessage: '' },
    })
  }

  private serializeConfig(row: {
    enabled: boolean
    deviceKey: string | null
    chuteMessage: string
    requireMemberId: boolean
    printData: string | null
    updatedAt: Date
  }) {
    return {
      enabled: row.enabled,
      deviceKey: row.deviceKey || '',
      chuteMessage: row.chuteMessage,
      requireMemberId: row.requireMemberId,
      printData: row.printData || '',
      updatedAt: row.updatedAt,
      hasDeviceKey: Boolean(row.deviceKey),
      outputs: previewWmsOutputs({
        chuteMessage: row.chuteMessage,
        requireMemberId: row.requireMemberId,
        printData: row.printData,
      }),
      spec: {
        weighSample: WCS_SPEC_SAMPLE_WEIGH_BODY,
        weighSuccess: { result: 'true', message: '' },
        weighMemberId: { result: 'true', message: WCS_MEMBER_ID_MESSAGE },
        imageOk: { ...WCS_IMAGE_OK },
      },
    }
  }

  private async persistWeighFailure(body: unknown, ctx: WcsCallContext, message: string) {
    const reply = buildWcsWeighReply({ ok: false, message })
    const items = normalizeWcsWeighBody(body)
    const snapshot = items[0]
    await this.prisma.wcsWeighEvent.create({
      data: {
        ticketsNum: snapshot?.ticketsNum.slice(0, 80) || '',
        weightKg: snapshot?.weight.slice(0, 40) || '',
        lengthMm: snapshot?.length.slice(0, 40) || '',
        widthMm: snapshot?.width.slice(0, 40) || '',
        heightMm: snapshot?.height.slice(0, 40) || '',
        volumeMm3: snapshot?.volume.slice(0, 40) || '',
        machine: snapshot?.machine.slice(0, 80) || '',
        rawJson: (body ?? {}) as Prisma.InputJsonValue,
        result: reply.result,
        message: reply.message.slice(0, 200),
        source: ctx.source,
        clientIp: asWcsString(ctx.ip).slice(0, 64) || null,
      },
    })
    return reply
  }
}
