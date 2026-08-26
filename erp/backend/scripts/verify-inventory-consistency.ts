#!/usr/bin/env ts-node
/**
 * 库存一致性对账：仓级 totalQty vs 库位 qty 汇总
 * 用法: npx ts-node -r tsconfig-paths/register scripts/verify-inventory-consistency.ts [--fix-hints]
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type MismatchRow = {
  productId: bigint
  sku: string
  warehouseCode: string
  warehouseTotal: number
  locationSum: number
  delta: number
  lockedQty: number
  availableQty: number
}

async function main() {
  const showHints = process.argv.includes('--fix-hints')

  const rows = await prisma.$queryRaw<MismatchRow[]>`
    SELECT
      i.product_id AS productId,
      i.sku,
      i.warehouse_code AS warehouseCode,
      i.total_qty AS warehouseTotal,
      i.locked_qty AS lockedQty,
      i.available_qty AS availableQty,
      COALESCE(loc.location_sum, 0) AS locationSum,
      i.total_qty - COALESCE(loc.location_sum, 0) AS delta
    FROM inventory i
    LEFT JOIN (
      SELECT product_id, warehouse_code, SUM(qty) AS location_sum
      FROM inventory_location
      WHERE qty > 0
      GROUP BY product_id, warehouse_code
    ) loc ON loc.product_id = i.product_id AND loc.warehouse_code = i.warehouse_code
    WHERE i.total_qty != COALESCE(loc.location_sum, 0)
    ORDER BY ABS(i.total_qty - COALESCE(loc.location_sum, 0)) DESC, i.warehouse_code, i.sku
    LIMIT 500
  `

  const orphanLocations = await prisma.$queryRaw<Array<{ productId: bigint; sku: string; warehouseCode: string; locationSum: number }>>`
    SELECT
      il.product_id AS productId,
      il.sku,
      il.warehouse_code AS warehouseCode,
      SUM(il.qty) AS locationSum
    FROM inventory_location il
    LEFT JOIN inventory i
      ON i.product_id = il.product_id AND i.warehouse_code = il.warehouse_code
    WHERE il.qty > 0 AND i.id IS NULL
    GROUP BY il.product_id, il.sku, il.warehouse_code
    ORDER BY locationSum DESC
    LIMIT 200
  `

  console.log('=== 库存一致性对账 ===')
  console.log(`仓级 vs 库位汇总不一致: ${rows.length} 条`)
  console.log(`库位有货但仓级缺失: ${orphanLocations.length} 条`)

  if (rows.length) {
    console.log('\n--- 不一致明细 (前 20) ---')
    for (const row of rows.slice(0, 20)) {
      console.log(
        `${row.warehouseCode} / ${row.sku}: 仓级=${row.warehouseTotal}, 库位合计=${row.locationSum}, 差=${row.delta}, 锁定=${row.lockedQty}`,
      )
    }
  }

  if (orphanLocations.length) {
    console.log('\n--- 库位孤儿库存 (前 10) ---')
    for (const row of orphanLocations.slice(0, 10)) {
      console.log(`${row.warehouseCode} / ${row.sku}: 库位合计=${row.locationSum} (无仓级记录)`)
    }
  }

  if (showHints && (rows.length || orphanLocations.length)) {
    console.log('\n--- 修复建议 ---')
    console.log('1. 盘点审批、入库上架、出库拣货/发运应均走 InventoryMutationService')
    console.log('2. 手工调整请用库存查询页的库位调整功能')
    console.log('3. 历史数据可编写一次性 backfill 脚本按库位汇总修正 inventory.total_qty')
  }

  const exitCode = rows.length || orphanLocations.length ? 1 : 0
  await prisma.$disconnect()
  process.exit(exitCode)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
