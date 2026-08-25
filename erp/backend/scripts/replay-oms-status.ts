/**
 * 把 ERP 现有入库/退货/出库状态再推一遍到 OMS。
 * 用法（在 erp/backend 目录）:
 *   npx ts-node -r tsconfig-paths/register --transpile-only scripts/replay-oms-status.ts
 */
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../src/app.module'
import { InboundModule } from '../src/modules/inbound/inbound.module'
import { InboundService } from '../src/modules/inbound/inbound.service'
import { ReturnsModule } from '../src/modules/returns/returns.module'
import { ReturnsService } from '../src/modules/returns/returns.service'
import { OutboundModule } from '../src/modules/outbound/outbound.module'
import { OutboundService } from '../src/modules/outbound/outbound.service'

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })
  try {
    const inbound = app.select(InboundModule).get(InboundService)
    const returns = app.select(ReturnsModule).get(ReturnsService)
    const outbound = app.select(OutboundModule).get(OutboundService)

    console.log('=== inbound.status ===')
    const inboundRows = await inbound.replayOmsStatuses()
    for (const row of inboundRows) {
      console.log(`${row.ok ? 'OK' : 'FAIL'} ${row.inboundNo} → ${row.omsStatus}`)
    }

    console.log('\n=== return.status ===')
    const returnRows = await returns.replayOmsStatuses()
    for (const row of returnRows) {
      console.log(`${row.ok ? 'OK' : 'FAIL'} ${row.returnNo} → ${row.status}`)
    }

    console.log('\n=== outbound.status (含 cancelled 纠正) ===')
    const outboundRows = await outbound.replayOmsStatuses()
    for (const row of outboundRows) {
      console.log(`${row.ok ? 'OK' : 'FAIL'} ${row.outboundNo} → ${row.omsStatus}`)
    }

    const failed = [...inboundRows, ...returnRows, ...outboundRows].filter((r) => !r.ok)
    console.log(
      `\n完成：入库 ${inboundRows.length}，退货 ${returnRows.length}，出库 ${outboundRows.length}，失败 ${failed.length}`,
    )
    if (failed.length) process.exitCode = 1
  } finally {
    await app.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
