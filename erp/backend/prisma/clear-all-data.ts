/**
 * 清空 ERP 全部业务数据与人员账号（保留表结构、角色与权限定义）
 * 用法: npx ts-node prisma/clear-all-data.ts
 */
import { PrismaClient } from '@prisma/client'

const TABLES = [
  'product_price_record',
  'product_pricing_history',
  'product_pricing',
  'operation_log',
  'announcement',
  'async_io_job',
  'sync_log',
  'supplier_freight_bill',
  'profit_analysis',
  'cost_ledger',
  'customer_recharge',
  'billing_order_item',
  'billing_order',
  'customer',
  'lead_deal',
  'lead_follow_up',
  'lead',
  'logistics_receipt_item',
  'logistics_receipt',
  'inventory_log',
  'inventory',
  'inbound_order_item',
  'inbound_order',
  'purchase_order_item',
  'purchase_order',
  'product_dev',
  'product',
  'warehouse',
  'supplier',
  'sys_user_permission',
  'sys_user',
  'sys_role_permission',
]

async function main() {
  const prisma = new PrismaClient()
  console.log('开始清空数据（保留 sys_role / sys_permission 定义）...\n')

  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0')
  for (const table of TABLES) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``)
    console.log(`  ✓ 已清空 ${table}`)
  }
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1')

  const checks: Record<string, number> = {
    用户: await prisma.sysUser.count(),
    商品: await prisma.product.count(),
    供应商: await prisma.supplier.count(),
    线索: await prisma.lead.count(),
    采购单: await prisma.purchaseOrder.count(),
  }

  console.log('\n清空后统计:')
  for (const [k, v] of Object.entries(checks)) {
    console.log(`  ${k}: ${v}`)
  }

  console.log('\n完成。当前无法登录，导入数据后或执行 seed 恢复管理员账号。')
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
