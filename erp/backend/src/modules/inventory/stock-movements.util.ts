import type { PrismaService } from '../../common/prisma/prisma.service'
import { getPagination, type PaginationDto } from '../../common/dto/pagination.dto'
import { expandWarehouseSearchTerms, JHB_WAREHOUSE_CODE } from '../../common/warehouse-display.util'

export async function readStockMovements(
  prisma: PrismaService,
  sku: string,
  query: PaginationDto & { warehouseCode?: string },
) {
  const { page, pageSize } = getPagination(query)
  const warehouseCode = query.warehouseCode === JHB_WAREHOUSE_CODE
    ? { in: expandWarehouseSearchTerms([JHB_WAREHOUSE_CODE]) }
    : query.warehouseCode
  const where = {
    sku,
    ...(warehouseCode && warehouseCode !== 'all' ? { warehouseCode } : {}),
    changeType: { in: ['outbound', 'putaway'] },
  }
  const [rows, total] = await Promise.all([
    prisma.inventoryLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.inventoryLog.count({ where }),
  ])
  const references = (type: string) => [...new Set(rows.flatMap(row =>
    row.changeType === type && row.referenceNo ? [row.referenceNo] : [],
  ))]
  const outboundNos = references('outbound')
  const inboundNos = references('putaway')
  const [outboundOrders, inboundOrders, auditLogs] = await Promise.all([
    outboundNos.length ? prisma.outboundOrder.findMany({
      where: { outboundNo: { in: outboundNos } },
      select: {
        outboundNo: true, customerId: true, pickerId: true,
        items: { where: { sku }, select: {
          locationCode: true,
          pickAllocations: { where: { status: 'shipped' }, orderBy: { id: 'asc' }, select: { inboundNo: true, batchNo: true, locationCode: true, qty: true, unitCostRmb: true } },
        } },
      },
    }) : [],
    inboundNos.length ? prisma.inboundOrder.findMany({
      where: { inboundNo: { in: inboundNos } },
      select: { inboundNo: true, omsCustomerCode: true },
    }) : [],
    outboundNos.length || inboundNos.length ? prisma.operationLog.findMany({
      where: { ipAddress: { not: null }, OR: [
        { module: 'outbound', action: 'ship', targetId: { in: outboundNos } },
        { module: 'inbound', action: 'putaway', targetId: { in: inboundNos } },
      ] },
      select: { detail: true, ipAddress: true },
    }) : [],
  ])

  const userIds = [...new Set([...rows.map(row => row.operatorId), ...outboundOrders.map(order => order.pickerId)]
    .filter((id): id is bigint => id != null))]
  const customerIds = outboundOrders.flatMap(order => order.customerId == null ? [] : [order.customerId])
  const customerCodes = inboundOrders.flatMap(order => order.omsCustomerCode ? [order.omsCustomerCode] : [])
  const [users, customers] = await Promise.all([
    userIds.length ? prisma.sysUser.findMany({ where: { id: { in: userIds } }, select: { id: true, realName: true, username: true } }) : [],
    customerIds.length || customerCodes.length ? prisma.customer.findMany({
      where: { OR: [{ id: { in: customerIds } }, { customerCode: { in: customerCodes } }] },
      select: { id: true, customerCode: true, customerName: true },
    }) : [],
  ])
  const usersById = new Map(users.map(user => [user.id, user.realName || user.username] as const))
  const customersById = new Map(customers.map(customer => [customer.id, customer.customerName || customer.customerCode] as const))
  const customersByCode = new Map(customers.map(customer => [customer.customerCode, customer.customerName || customer.customerCode] as const))
  const outboundByNo = new Map(outboundOrders.map(order => [order.outboundNo, order] as const))
  const inboundByNo = new Map(inboundOrders.map(order => [order.inboundNo, order] as const))
  const ipByMovementId = new Map<string, string>()
  for (const audit of auditLogs) {
    const detail = audit.detail
    if (!audit.ipAddress || !detail || typeof detail !== 'object' || Array.isArray(detail) || !Array.isArray(detail.inventoryLogIds)) continue
    for (const id of detail.inventoryLogIds) if (typeof id === 'string') ipByMovementId.set(id, audit.ipAddress)
  }

  const items = rows.map(row => {
    const referenceNo = row.referenceNo || ''
    const isOutbound = row.changeType === 'outbound'
    const outbound = isOutbound ? outboundByNo.get(referenceNo) : undefined
    const inbound = isOutbound ? undefined : inboundByNo.get(referenceNo)
    const inboundCustomerCode = inbound?.omsCustomerCode || ''
    const allocations = outbound?.items.flatMap(item => item.pickAllocations) || []
    return {
      id: String(row.id),
      direction: isOutbound ? 'outbound' : 'inbound',
      referenceNo,
      warehouseCode: row.warehouseCode,
      changeQty: row.changeQty,
      beforeQty: row.beforeQty,
      afterQty: row.afterQty,
      customerName: outbound?.customerId != null ? customersById.get(outbound.customerId) || ''
        : customersByCode.get(inboundCustomerCode) || inboundCustomerCode,
      operatorName: row.operatorId != null ? usersById.get(row.operatorId) || `#${row.operatorId}` : '',
      pickerName: outbound?.pickerId != null ? usersById.get(outbound.pickerId) || `#${outbound.pickerId}` : '',
      locationCode: isOutbound
        ? [...new Set(allocations.map(lot => lot.locationCode).filter(Boolean))].join('、')
          || row.remark?.match(/^库位\s+(\S+)/)?.[1] || outbound?.items[0]?.locationCode || ''
        : row.remark || '',
      inboundLots: allocations.map(lot => ({
        batch: lot.inboundNo || lot.batchNo || '期初',
        qty: lot.qty,
        unitCostRmb: lot.unitCostRmb == null ? null : Number(lot.unitCostRmb),
      })),
      ipAddress: ipByMovementId.get(String(row.id)) ?? null,
      createdAt: row.createdAt,
    }
  })
  return { items, total, page, pageSize }
}
