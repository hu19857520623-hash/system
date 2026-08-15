import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'

@Injectable()
export class WarehouseService {
  constructor(private prisma: PrismaService) {}

  list(type?: string) {
    const where: any = {}
    if (type) {
      // API 别名：overseas = 海外仓（DB 仍存 wms）
      where.warehouseType = type === 'overseas' ? 'wms' : type
    }
    return this.prisma.warehouse.findMany({ where, orderBy: { id: 'asc' } })
  }

  async detail(id: number) {
    const row = await this.prisma.warehouse.findUnique({ where: { id } })
    if (!row) throw new NotFoundException('仓库不存在')
    return row
  }

  create(data: any) {
    return this.prisma.warehouse.create({
      data: {
        warehouseCode: data.warehouseCode,
        warehouseName: data.warehouseName,
        warehouseType: data.warehouseType || 'logistics',
        address: data.address,
        city: data.city,
        country: data.country,
        contactName: data.contactName,
        contactPhone: data.contactPhone,
      },
    })
  }

  async update(id: number, data: any) {
    await this.detail(id)
    return this.prisma.warehouse.update({
      where: { id },
      data: {
        warehouseName: data.warehouseName,
        address: data.address,
        city: data.city,
        country: data.country,
        contactName: data.contactName,
        contactPhone: data.contactPhone,
        status: data.status,
      },
    })
  }
}
