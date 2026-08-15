import { NestFactory } from '@nestjs/core'
import { AppModule } from '../src/app.module'
import { PurchaseService } from '../src/modules/purchase/purchase.service'

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  try {
    const service = app.get(PurchaseService)
    const result = await service.backfillFinanceApprovedCostLedgers()
    console.log(`processed ${result.processed} finance-approved purchase orders`)
  } finally {
    await app.close()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
