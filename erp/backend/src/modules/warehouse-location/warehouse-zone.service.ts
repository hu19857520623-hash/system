import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { OperationLogService } from '../operation-log/operation-log.service'
import { CacheService } from '../../common/cache/cache.service'

const ZONE_TYPES = new Set(['storage', 'staging', 'qc', 'return'])
const PARTITION_LETTERS = /^[A-Z]$/

@Injectable()
export class WarehouseZoneService {
  constructor(
    private prisma: PrismaService,
    private opLog: OperationLogService,
    private cache: CacheService,
  ) {}

  async list(warehouseCode?: string) {
    const where: any = {}
    if (warehouseCode) where.warehouseCode = warehouseCode
    const [rows, counts] = await Promise.all([
      this.cache.remember('warehouse-zones', `erp:warehouse-zones:${encodeURIComponent(JSON.stringify([warehouseCode ?? null]))}`, 120,
        async () => {
          const records = await this.prisma.warehouseZone.findMany({
            where, orderBy: [{ warehouseCode: 'asc' }, { zoneCode: 'asc' }],
          })
          return records.map(r => JSON.parse(JSON.stringify({ ...r, id: Number(r.id) }))) as Record<string, any>[]
        }),
      this.prisma.warehouseZone.findMany({
        where, select: { id: true, _count: { select: { locations: true } } },
      }),
    ])
    const countMap = new Map(counts.map(r => [Number(r.id), r._count.locations]))
    return rows.map(r => ({ ...r, _count: { locations: countMap.get(r.id) ?? 0 }, locationCount: countMap.get(r.id) ?? 0 }))
  }

  async create(data: any, operatorId?: number) {
    const warehouseCode = String(data.warehouseCode || '').trim()
    const zoneCode = String(data.zoneCode || '').trim()
    const zoneName = String(data.zoneName || '').trim()
    if (!warehouseCode || !zoneCode || !zoneName) {
      throw new BadRequestException('warehouseCode、zoneCode、zoneName 为必填')
    }
    if (!PARTITION_LETTERS.test(zoneCode)) {
      throw new BadRequestException('库区编码须为 A-Z 单字母（如 A、B、C）')
    }
    const zoneType = String(data.zoneType || 'storage')
    if (!ZONE_TYPES.has(zoneType)) throw new BadRequestException('无效的 zoneType')

    const wh = await this.prisma.warehouse.findUnique({ where: { warehouseCode } })
    if (!wh) throw new BadRequestException(`仓库 ${warehouseCode} 不存在`)

    const row = await this.prisma.warehouseZone.create({
      data: {
        warehouseCode,
        zoneCode,
        zoneName,
        zoneType,
        status: data.status === 0 ? 0 : 1,
        remark: data.remark || null,
      },
    })
    await this.cache.invalidate('warehouse-zones')
    await this.opLog.log({
      operatorId,
      module: 'warehouse_location',
      action: 'zone_create',
      targetType: 'warehouse_zone',
      targetId: `${warehouseCode}-${zoneCode}`,
      detail: { zoneName, zoneType },
    })
    return { ...row, id: Number(row.id) }
  }

  async update(id: number, data: any, operatorId?: number) {
    const row = await this.prisma.warehouseZone.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new NotFoundException('库区不存在')

    const zoneType = data.zoneType != null ? String(data.zoneType) : row.zoneType
    if (!ZONE_TYPES.has(zoneType)) throw new BadRequestException('无效的 zoneType')

    const updated = await this.prisma.warehouseZone.update({
      where: { id: BigInt(id) },
      data: {
        zoneName: data.zoneName != null ? String(data.zoneName) : undefined,
        zoneType,
        status: data.status != null ? (data.status === 0 ? 0 : 1) : undefined,
        remark: data.remark !== undefined ? data.remark : undefined,
      },
    })
    await this.cache.invalidate('warehouse-zones')
    await this.opLog.log({
      operatorId,
      module: 'warehouse_location',
      action: 'zone_update',
      targetType: 'warehouse_zone',
      targetId: `${row.warehouseCode}-${row.zoneCode}`,
      detail: { zoneName: updated.zoneName, zoneType: updated.zoneType },
    })
    return { ...updated, id: Number(updated.id) }
  }

  async usedPartitionLetters(warehouseCode: string) {
    const rows = await this.prisma.warehouseZone.findMany({
      where: { warehouseCode, status: 1 },
      select: { zoneCode: true },
    })
    return rows.map((r) => r.zoneCode).filter((c) => PARTITION_LETTERS.test(c))
  }
}
