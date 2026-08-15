/**
 * 取消在途测试入库单，并回滚中转仓发运扣减（inbound_allocate）
 * 用法: npx ts-node prisma/cleanup-pending-test-inbounds.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const candidates = await prisma.inboundOrder.findMany({
    where: {
      status: { in: ['pending_receipt', 'pending_push', 'push_failed', 'pushed', 'arrived'] },
    },
    include: { items: true },
  })
  const toCancel = candidates.filter((o) =>
    o.inboundNo.startsWith('IN-UI-') || o.inboundNo.startsWith('IN-E2E-'),
  )

  if (!toCancel.length) {
    console.log('No pending test inbound orders to clean.')
    return
  }

  for (const order of toCancel) {
    await prisma.$transaction(async (tx) => {
      const sourceWh = order.sourceWarehouseCode
      if (sourceWh) {
        for (const item of order.items) {
          const qty = item.expectedQty
          const inv = await tx.inventory.findUnique({
            where: {
              productId_warehouseCode: {
                productId: item.productId,
                warehouseCode: sourceWh,
              },
            },
          })
          if (inv) {
            const before = inv.totalQty
            const after = before + qty
            await tx.inventory.update({
              where: { id: inv.id },
              data: {
                totalQty: after,
                availableQty: inv.availableQty + qty,
              },
            })
            await tx.inventoryLog.create({
              data: {
                productId: item.productId,
                sku: item.sku,
                warehouseCode: sourceWh,
                changeType: 'adjust',
                changeQty: qty,
                beforeQty: before,
                afterQty: after,
                referenceNo: order.inboundNo,
                remark: `取消测试入库单 ${order.inboundNo}，回滚发运扣减`,
              },
            })
          }
        }
      }

      await tx.inboundArrivalScan.deleteMany({ where: { inboundId: order.id } })
      await tx.inboundPutawayItem.deleteMany({ where: { inboundId: order.id } })
      await tx.inboundOrderItem.deleteMany({ where: { inboundId: order.id } })
      await tx.inboundOrder.delete({ where: { id: order.id } })
    })
    console.log(`✓ 已取消 ${order.inboundNo} (${order.status})`)
  }

  console.log(`Done. Cleaned ${toCancel.length} order(s).`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
