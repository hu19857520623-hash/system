import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { LogisticsReceiptService } from '../modules/logistics-receipt/logistics-receipt.service'
import { userFacingError } from '@erp/shared/user-facing-error'

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  try {
    const result = await app.get(LogisticsReceiptService).reconcileDamagedReceipts(process.argv.includes('--apply'))
    console.log(JSON.stringify(result))
  } finally { await app.close() }
}
main().catch(error => { console.error(userFacingError(error)); process.exitCode = 1 })
