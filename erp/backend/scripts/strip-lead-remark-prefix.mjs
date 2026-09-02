import { PrismaClient } from '@prisma/client'

const LEADING =
  /^(?:(?:\s*(?:留资|前端|获客|对接|再对接|销售情况):[^|]*)\s*(?:\|\s*)?)+/u

function strip(remark) {
  let text = String(remark || '').trim()
  if (!text) return null
  text = text.replace(LEADING, '').trim()
  text = text.replace(/^备注:\s*/u, '').trim()
  return text || null
}

const prisma = new PrismaClient()

async function main() {
  const rows = await prisma.lead.findMany({
    where: { remark: { not: null } },
    select: { id: true, leadNo: true, remark: true },
  })
  let updated = 0
  for (const row of rows) {
    const next = strip(row.remark)
    const prev = row.remark?.trim() || null
    if (next !== prev) {
      await prisma.lead.update({ where: { id: row.id }, data: { remark: next } })
      updated++
    }
  }
  const samples = await prisma.lead.findMany({
    where: { leadNo: { in: ['LD-GJ-3570', 'LD-GJ-0001'] } },
    select: { leadNo: true, remark: true },
  })
  console.log(JSON.stringify({ scanned: rows.length, updated, samples }, null, 2))
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
