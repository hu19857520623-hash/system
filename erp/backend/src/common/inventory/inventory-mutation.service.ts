import { BadRequestException, Injectable } from '@nestjs/common'
import type {
  InventoryTx,
  LocationDeductLine,
  LocationStockParams,
  RestoreLocationParams,
  ShipDeductParams,
  StocktakeAdjustParams,
  WarehouseDeltaParams,
} from './inventory-mutation.types'

@Injectable()
export class InventoryMutationService {
  /** 仓级库存增减并写 InventoryLog */
  async applyWarehouseQtyDelta(tx: InventoryTx, params: WarehouseDeltaParams) {
    const { productId, sku, warehouseCode, diff, operatorId, changeType, remark, referenceNo } = params
    if (diff === 0) return

    const whInv = await tx.inventory.findUnique({
      where: { productId_warehouseCode: { productId, warehouseCode } },
    })
    const before = whInv?.totalQty ?? 0
    const after = before + diff

    if (after < 0) throw new BadRequestException('仓库库存不足，无法减少')
    if (whInv && after < whInv.lockedQty) {
      throw new BadRequestException(`调整后总量 ${after} 低于锁定数量 ${whInv.lockedQty}`)
    }

    if (whInv) {
      await tx.inventory.update({
        where: { id: whInv.id },
        data: {
          totalQty: after,
          availableQty: whInv.availableQty + diff,
        },
      })
    } else if (diff > 0) {
      await tx.inventory.create({
        data: {
          productId,
          sku,
          warehouseCode,
          totalQty: after,
          availableQty: after,
        },
      })
    } else {
      throw new BadRequestException('仓库库存不存在')
    }

    await tx.inventoryLog.create({
      data: {
        productId,
        sku,
        warehouseCode,
        changeType,
        changeQty: diff,
        beforeQty: before,
        afterQty: after,
        referenceNo: referenceNo || null,
        operatorId: operatorId ? BigInt(operatorId) : undefined,
        remark: remark || null,
      },
    })
  }

  /** 库位加库存（存在则累加）并同步仓级 */
  async addLocationStock(
    tx: InventoryTx,
    params: LocationStockParams,
    meta: { changeType: string; operatorId?: number; referenceNo?: string; remark?: string },
  ) {
    const invLoc = await tx.inventoryLocation.findFirst({
      where: {
        productId: params.productId,
        locationId: params.locationId,
        batchNo: params.batchNo ?? null,
      },
    })

    if (invLoc) {
      await tx.inventoryLocation.update({
        where: { id: invLoc.id },
        data: {
          qty: invLoc.qty + params.qty,
          inboundNo: params.inboundNo ?? invLoc.inboundNo,
        },
      })
    } else {
      await tx.inventoryLocation.create({
        data: {
          productId: params.productId,
          sku: params.sku,
          warehouseCode: params.warehouseCode,
          locationId: params.locationId,
          locationCode: params.locationCode,
          qty: params.qty,
          batchNo: params.batchNo ?? null,
          inboundNo: params.inboundNo ?? null,
        },
      })
    }

    await this.applyWarehouseQtyDelta(tx, {
      productId: params.productId,
      sku: params.sku,
      warehouseCode: params.warehouseCode,
      diff: params.qty,
      operatorId: meta.operatorId,
      changeType: meta.changeType,
      referenceNo: meta.referenceNo,
      remark: meta.remark ?? params.locationCode,
    })
  }

  /** FIFO 扣减库位库存，返回各批次扣减明细 */
  async deductLocationQtyFifo(
    tx: InventoryTx,
    params: { locationId: bigint; sku: string; qty: number },
  ): Promise<LocationDeductLine[]> {
    const stocks = await tx.inventoryLocation.findMany({
      where: { locationId: params.locationId, sku: params.sku, qty: { gt: 0 } },
      orderBy: { id: 'asc' },
    })
    const available = stocks.reduce((sum, stock) => sum + stock.qty, 0)
    if (available < params.qty) {
      throw new BadRequestException(`库位库存不足（可用 ${available}，需 ${params.qty}）`)
    }

    let remaining = params.qty
    const lines: LocationDeductLine[] = []
    for (const stock of stocks) {
      if (remaining <= 0) break
      const deductQty = Math.min(remaining, stock.qty)
      const deducted = await tx.inventoryLocation.updateMany({
        where: { id: stock.id, qty: { gte: deductQty } },
        data: { qty: { decrement: deductQty } },
      })
      if (deducted.count !== 1) {
        throw new BadRequestException('库位库存已变化，请刷新后重试')
      }
      lines.push({ inventoryLocationId: stock.id, qty: deductQty })
      remaining -= deductQty
    }
    return lines
  }

  /** 盘点审批：将库位库存调整到目标数量并同步仓级 */
  async adjustLocationToTarget(tx: InventoryTx, params: StocktakeAdjustParams) {
    const currentRows = await tx.inventoryLocation.findMany({
      where: { productId: params.productId, locationId: params.locationId },
      orderBy: { id: 'asc' },
    })
    if (!currentRows.length) {
      throw new BadRequestException(`库位库存 ${params.locationCode}/${params.sku} 已不存在`)
    }

    const currentQty = currentRows.reduce((sum, row) => sum + row.qty, 0)
    const delta = params.targetQty - currentQty
    if (!delta) return

    if (delta > 0) {
      await tx.inventoryLocation.update({
        where: { id: currentRows[0].id },
        data: { qty: currentRows[0].qty + delta },
      })
    } else {
      let remaining = -delta
      for (const row of currentRows) {
        if (!remaining) break
        const deduct = Math.min(row.qty, remaining)
        await tx.inventoryLocation.update({
          where: { id: row.id },
          data: { qty: row.qty - deduct },
        })
        remaining -= deduct
      }
    }

    await this.applyWarehouseQtyDelta(tx, {
      productId: params.productId,
      sku: params.sku,
      warehouseCode: params.warehouseCode,
      diff: delta,
      operatorId: params.operatorId,
      changeType: 'stocktake',
      referenceNo: params.referenceNo,
      remark: `盘点调整 · ${params.locationCode}`,
    })
  }

  /** 发运扣减：totalQty + lockedQty 同步减少 */
  async shipDeductWarehouse(tx: InventoryTx, params: ShipDeductParams) {
    const inv = await tx.inventory.findUnique({
      where: {
        productId_warehouseCode: { productId: params.productId, warehouseCode: params.warehouseCode },
      },
    })
    if (!inv || inv.lockedQty < params.qty) {
      throw new BadRequestException(`${params.sku} 锁定库存不足`)
    }

    await tx.inventory.update({
      where: { id: inv.id },
      data: {
        totalQty: inv.totalQty - params.qty,
        lockedQty: inv.lockedQty - params.qty,
      },
    })

    await tx.inventoryLog.create({
      data: {
        productId: params.productId,
        sku: params.sku,
        warehouseCode: params.warehouseCode,
        changeType: 'outbound',
        changeQty: -params.qty,
        beforeQty: inv.totalQty,
        afterQty: inv.totalQty - params.qty,
        referenceNo: params.referenceNo,
        operatorId: params.operatorId ? BigInt(params.operatorId) : null,
        remark: params.remark ?? null,
      },
    })
  }

  /** 取消拣货：原路回补库位库存 */
  async restoreLocationQty(tx: InventoryTx, params: RestoreLocationParams) {
    const existing = params.inventoryLocationId
      ? await tx.inventoryLocation.findFirst({ where: { id: params.inventoryLocationId } })
      : null

    if (existing) {
      await tx.inventoryLocation.update({
        where: { id: existing.id },
        data: { qty: { increment: params.qty } },
      })
    } else {
      await tx.inventoryLocation.create({
        data: {
          productId: params.productId,
          sku: params.sku,
          warehouseCode: params.warehouseCode,
          locationId: params.locationId,
          locationCode: params.locationCode,
          qty: params.qty,
        },
      })
    }
  }
}
