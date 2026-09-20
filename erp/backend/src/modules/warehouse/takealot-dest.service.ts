import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { DEFAULT_TAKEALOT_DEST_ROWS, type TakealotDestRow } from './takealot-dest.defaults'
import { setTakealotDestCache } from './takealot-dest.cache'

function parseAliases(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.map((v) => String(v).trim().toUpperCase()).filter(Boolean))]
    }
  } catch {
    return raw.split(/[,，\s]+/).map((v) => v.trim().toUpperCase()).filter(Boolean)
  }
  return []
}

function serializeAliases(values: string[] | undefined): string {
  const list = [...new Set((values || []).map((v) => v.trim().toUpperCase()).filter(Boolean))]
  return JSON.stringify(list)
}

@Injectable()
export class TakealotDestService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.refreshCache(true)
  }

  private present(row: {
    id: number
    code: string
    omsWarehouseId: string | null
    label: string
    city: string | null
    matchAliases: string
    enabled: boolean
    sortOrder: number
  }): TakealotDestRow {
    return {
      id: row.id,
      code: row.code.trim().toUpperCase(),
      omsWarehouseId: row.omsWarehouseId?.trim().toLowerCase() || null,
      label: row.label.trim(),
      city: row.city?.trim() || null,
      matchAliases: parseAliases(row.matchAliases),
      enabled: Boolean(row.enabled),
      sortOrder: row.sortOrder,
    }
  }

  async refreshCache(ensureSeed = false) {
    if (ensureSeed) {
      const count = await this.prisma.takealotDestWarehouse.count()
      if (count === 0) {
        for (const row of DEFAULT_TAKEALOT_DEST_ROWS) {
          await this.prisma.takealotDestWarehouse.create({
            data: {
              code: row.code,
              omsWarehouseId: row.omsWarehouseId,
              label: row.label,
              city: row.city,
              matchAliases: serializeAliases([row.code, ...row.matchAliases]),
              enabled: row.enabled,
              sortOrder: row.sortOrder,
            },
          })
        }
      }
    }
    const rows = await this.prisma.takealotDestWarehouse.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })
    setTakealotDestCache(rows.map((row) => this.present(row)))
  }

  async list(includeDisabled = false) {
    await this.refreshCache(false)
    const where = includeDisabled ? {} : { enabled: true }
    const rows = await this.prisma.takealotDestWarehouse.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    })
    return { items: rows.map((row) => this.present(row)) }
  }

  /** OMS 出库目的仓下拉：按 omsWarehouseId 去重 */
  async listForOmsFulfillment() {
    const seen = new Set<string>()
    const items: { id: string; city: string }[] = []
    for (const row of (await this.list()).items) {
      if (!row.omsWarehouseId || seen.has(row.omsWarehouseId)) continue
      seen.add(row.omsWarehouseId)
      items.push({ id: row.omsWarehouseId, city: row.city || row.label })
    }
    return { items }
  }

  async create(data: {
    code: string
    omsWarehouseId?: string | null
    label?: string
    city?: string | null
    matchAliases?: string[]
    enabled?: boolean
    sortOrder?: number
  }) {
    const code = data.code?.trim().toUpperCase()
    if (!code) throw new BadRequestException('请填写目的仓代码')
    const label = (data.label || code).trim()
    const aliases = serializeAliases([...(data.matchAliases || []), code])
    const row = await this.prisma.takealotDestWarehouse.create({
      data: {
        code,
        omsWarehouseId: data.omsWarehouseId?.trim().toLowerCase() || null,
        label,
        city: data.city?.trim() || null,
        matchAliases: aliases,
        enabled: data.enabled !== false,
        sortOrder: data.sortOrder ?? 0,
      },
    })
    await this.refreshCache(false)
    return this.present(row)
  }

  async update(id: number, data: Partial<{
    code: string
    omsWarehouseId: string | null
    label: string
    city: string | null
    matchAliases: string[]
    enabled: boolean
    sortOrder: number
  }>) {
    const existing = await this.prisma.takealotDestWarehouse.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('目的仓配置不存在')
    const code = data.code !== undefined ? data.code.trim().toUpperCase() : existing.code
    const row = await this.prisma.takealotDestWarehouse.update({
      where: { id },
      data: {
        ...(data.code !== undefined ? { code } : {}),
        ...(data.omsWarehouseId !== undefined ? { omsWarehouseId: data.omsWarehouseId?.trim().toLowerCase() || null } : {}),
        ...(data.label !== undefined ? { label: data.label.trim() } : {}),
        ...(data.city !== undefined ? { city: data.city?.trim() || null } : {}),
        ...(data.matchAliases !== undefined ? { matchAliases: serializeAliases(data.matchAliases) } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    })
    await this.refreshCache(false)
    return this.present(row)
  }
}
