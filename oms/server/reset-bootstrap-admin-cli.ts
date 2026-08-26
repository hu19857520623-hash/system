import { PrismaClient } from '@prisma/client'
import { ensureConfiguredPortalAdmin } from './bootstrap-admin.js'

const prisma = new PrismaClient()

async function main() {
  const result = await ensureConfiguredPortalAdmin(prisma)
  console.log(JSON.stringify({ ok: true, ...result }))
}

main()
  .catch(error => {
    console.error('Bootstrap admin reset failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
