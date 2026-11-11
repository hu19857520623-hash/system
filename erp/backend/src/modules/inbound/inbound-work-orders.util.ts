import { BadRequestException } from '@nestjs/common'
import { getPagination } from '../../common/dto/pagination.dto'
import type { PrismaService } from '../../common/prisma/prisma.service'

/** Warehouse choices are actual ERP work, independent of OMS mirrors and history limits. */
export async function listInboundWorkOrders(db: PrismaService, query: { warehouseCode?: unknown; page?: unknown; pageSize?: unknown }) {
  if (typeof query.warehouseCode !== 'string' || !query.warehouseCode.trim() || query.warehouseCode.trim().length > 30) {
    throw new BadRequestException('请选择有效的海外仓后读取作业单')
  }
  const { page, pageSize } = getPagination(query)
  const where = { warehouseCode: query.warehouseCode.trim(), status: { in: ['arrived', 'receiving', 'pending_putaway', 'exception'] } }
  const [rows, total] = await Promise.all([
    db.inboundOrder.findMany({ where, select: { id: true, inboundNo: true, warehouseCode: true, status: true }, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    db.inboundOrder.count({ where }),
  ])
  return { items: rows.map(row => ({ ...row, id: Number(row.id), readOnly: false })), total, page, pageSize }
}
