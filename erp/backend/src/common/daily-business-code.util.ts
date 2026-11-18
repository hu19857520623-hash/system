import { ConflictException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'

const shanghaiDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
})
const dailyLimit = 9999

export async function nextDailyBusinessCode(tx: Prisma.TransactionClient, prefix: 'PD' | 'SUP', now = new Date()) {
  const [day, month, year] = shanghaiDate.format(now).split('/')
  const businessDate = `${year}${month}${day}`

  await tx.$executeRaw`
    INSERT INTO daily_business_code (prefix, business_date, current_serial)
    VALUES (${prefix}, ${businessDate}, 1)
    ON DUPLICATE KEY UPDATE current_serial = current_serial + 1
  `
  const [counter] = await tx.$queryRaw<{ current_serial: bigint | number }[]>`
    SELECT current_serial FROM daily_business_code WHERE prefix = ${prefix} AND business_date = ${businessDate}
  `
  const start = Number(counter.current_serial)
  for (let sequence = start; sequence <= dailyLimit; sequence++) {
    const code = `${prefix}${businessDate}${String(sequence).padStart(4, '0')}`
    const occupied = prefix === 'PD'
      ? await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM product_dev WHERE apply_no = ${code}`
      : await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM supplier WHERE supplier_code = ${code}`
    if (occupied.length) continue

    if (sequence !== start) {
      await tx.$executeRaw`
        UPDATE daily_business_code SET current_serial = ${sequence}
        WHERE prefix = ${prefix} AND business_date = ${businessDate}
      `
    }
    return code
  }
  throw new ConflictException(`${prefix} ${businessDate} 的编号已达到每日上限（${dailyLimit}）`)
}
