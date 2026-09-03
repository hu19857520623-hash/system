import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'

@Injectable()
export class WarehouseService {
  constructor(private prisma: PrismaService) {}

  private parseVolumeCbm(value: unknown): number | null {
    if (value == null || value === '') return null
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) return null
    return Math.round(n * 10000) / 10000
  }

  private normalizeRequiredFiles(value: unknown): string[] {
    let values: unknown[] = []
    if (Array.isArray(value)) values = value
    else if (typeof value === 'string' && value.trim()) {
      try { values = JSON.parse(value) } catch { values = value.split(',') }
    }
    const allowed = new Set(['outerLabel', 'skuLabel', 'deliveryList', 'appointment'])
    return [...new Set(values.map(String).map(item => item.trim()).filter(item => allowed.has(item)))]
  }

  private serializeRequiredFiles(value: unknown) {
    return JSON.stringify(this.normalizeRequiredFiles(value))
  }

  private present<T extends { requiredOutboundFiles?: string | null; totalVolumeCbm?: unknown }>(row: T) {
    return {
      ...row,
      requiredOutboundFiles: this.normalizeRequiredFiles(row.requiredOutboundFiles),
      totalVolumeCbm: this.parseVolumeCbm(row.totalVolumeCbm),
    }
  }

  async list(type?: string) {
    const where: any = {}
    if (type) {
      // API 别名：overseas = 海外仓（DB 仍存 wms）
      where.warehouseType = type === 'overseas' ? 'wms' : type
    }
    const rows = await this.prisma.warehouse.findMany({ where, orderBy: { id: 'asc' } })
    return rows.map(row => this.present(row))
  }

  async detail(id: number) {
    const row = await this.prisma.warehouse.findUnique({ where: { id } })
    if (!row) throw new NotFoundException('仓库不存在')
    return this.present(row)
  }

  async create(data: any) {
    const row = await this.prisma.warehouse.create({
      data: {
        warehouseCode: data.warehouseCode,
        warehouseName: data.warehouseName,
        warehouseType: data.warehouseType || 'logistics',
        address: data.address,
        city: data.city,
        country: data.country,
        contactName: data.contactName,
        contactPhone: data.contactPhone,
        requiredOutboundFiles: this.serializeRequiredFiles(data.requiredOutboundFiles),
        totalVolumeCbm: this.parseVolumeCbm(data.totalVolumeCbm),
      },
    })
    return this.present(row)
  }

  async update(id: number, data: any) {
    await this.detail(id)
    const row = await this.prisma.warehouse.update({
      where: { id },
      data: {
        ...(data.warehouseName !== undefined ? { warehouseName: data.warehouseName } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.city !== undefined ? { city: data.city } : {}),
        ...(data.country !== undefined ? { country: data.country } : {}),
        ...(data.contactName !== undefined ? { contactName: data.contactName } : {}),
        ...(data.contactPhone !== undefined ? { contactPhone: data.contactPhone } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.requiredOutboundFiles !== undefined
          ? { requiredOutboundFiles: this.serializeRequiredFiles(data.requiredOutboundFiles) }
          : {}),
        ...(data.totalVolumeCbm !== undefined ? { totalVolumeCbm: this.parseVolumeCbm(data.totalVolumeCbm) } : {}),
      },
    })
    return this.present(row)
  }

  async updateCapacity(id: number, totalVolumeCbm: unknown) {
    return this.update(id, { totalVolumeCbm })
  }
}
