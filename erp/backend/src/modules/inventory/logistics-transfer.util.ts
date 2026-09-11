import { BadRequestException } from '@nestjs/common'

export type LogisticsTransferInput = {
  sku: string
  fromWarehouseCode: string
  toWarehouseCode: string
  qty: number
  remark?: string
}

type LogisticsWarehouse = {
  warehouseCode: string
  warehouseName: string
  warehouseType: string
  status: number
}

export function parseLogisticsTransferBody(body: Record<string, unknown>): LogisticsTransferInput {
  const sku = String(body.sku || '').trim()
  const fromWarehouseCode = String(body.fromWarehouseCode || '').trim()
  const toWarehouseCode = String(body.toWarehouseCode || '').trim()
  const qty = Number(body.qty)
  const remark = String(body.remark || '').trim()

  if (!sku) throw new BadRequestException('SKU 不能为空')
  if (!fromWarehouseCode || !toWarehouseCode) throw new BadRequestException('请选择调出仓和调入仓')
  if (fromWarehouseCode === toWarehouseCode) throw new BadRequestException('调出仓和调入仓不能相同')
  if (!Number.isInteger(qty) || qty <= 0) throw new BadRequestException('调拨数量须为正整数')

  return { sku, fromWarehouseCode, toWarehouseCode, qty, remark: remark || undefined }
}

export function assertLogisticsWarehouse(
  warehouse: LogisticsWarehouse | null | undefined,
  role: '调出' | '调入',
): LogisticsWarehouse {
  if (!warehouse || warehouse.warehouseType !== 'logistics') {
    throw new BadRequestException(`${role}仓不是有效的物流中转仓`)
  }
  if (warehouse.status !== 1) {
    throw new BadRequestException(`${role}仓已停用`)
  }
  return warehouse
}

export function transferLogRemarks(
  fromName: string,
  toName: string,
  remark?: string,
): { outRemark: string; inRemark: string } {
  const extra = remark ? ` · ${remark}` : ''
  return {
    outRemark: `调拨至 ${toName}${extra}`,
    inRemark: `从 ${fromName} 调入${extra}`,
  }
}
