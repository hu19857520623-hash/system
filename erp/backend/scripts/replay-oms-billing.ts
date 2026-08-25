/**
 * 把 ERP 客户余额、已确认费用、充值镜像到 OMS。
 * 用法（在 erp/backend 目录）:
 *   npx ts-node -r tsconfig-paths/register --transpile-only scripts/replay-oms-billing.ts
 */
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../src/app.module'
import { BillingModule } from '../src/modules/billing/billing.module'
import { BillingService } from '../src/modules/billing/billing.service'

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })
  try {
    const billing = app.select(BillingModule).get(BillingService)
    console.log('=== billing.changed ===')
    const rows = await billing.replayOmsBilling()
    for (const row of rows) {
      console.log(`${row.ok ? 'OK' : 'FAIL'} ${row.customerCode} 余额 ${row.balance}`)
    }
    const failed = rows.filter((r) => !r.ok)
    console.log(`\n完成：客户 ${rows.length}，失败 ${failed.length}`)
    if (failed.length) process.exitCode = 1
  } finally {
    await app.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
