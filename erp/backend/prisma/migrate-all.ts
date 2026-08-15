/**
 * Applies ordered SQL migrations exactly once.
 *
 * Use `npm run migrate:baseline` only for an existing database whose schema was
 * created before migration tracking was introduced. Back up the schema first.
 */
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { MIGRATION_ORDER } from './migration-plan'

const prisma = new PrismaClient()
const backendRoot = path.join(__dirname, '..')
const scriptsDir = path.join(__dirname, 'scripts')
const isBaseline = process.argv.includes('--baseline')

type AppliedMigration = { name: string; checksum: string }

function checksum(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

  function executeSqlFile(file: string): void {
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['prisma', 'db', 'execute', '--file', file],
    { cwd: backendRoot, stdio: 'inherit', shell: process.platform === 'win32' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`migration command exited with status ${result.status}`)
  }
}

async function main(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS _erp_migration (
      name VARCHAR(191) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB
  `)

  const lockRows = await prisma.$queryRawUnsafe<Array<{ acquired: bigint | number }>>(
    "SELECT GET_LOCK('erp_schema_migration', 30) AS acquired",
  )
  if (Number(lockRows[0]?.acquired) !== 1) {
    throw new Error('could not acquire the database migration lock')
  }

  try {
    const rows = await prisma.$queryRawUnsafe<AppliedMigration[]>(
      'SELECT name, checksum FROM _erp_migration',
    )
    const applied = new Map(rows.map((row) => [row.name, row.checksum]))

    for (const name of MIGRATION_ORDER) {
      const file = path.join(scriptsDir, name)
      if (!fs.existsSync(file)) throw new Error(`missing migration file: ${name}`)

      const digest = checksum(fs.readFileSync(file))
      const existingChecksum = applied.get(name)
      if (existingChecksum) {
        if (existingChecksum !== digest) {
          throw new Error(`checksum mismatch for already applied migration: ${name}`)
        }
        console.log(`✓ ${name}`)
        continue
      }

      if (isBaseline) console.log(`baseline ${name}`)
      else {
        console.log(`apply ${name}`)
        executeSqlFile(path.relative(backendRoot, file))
      }

      await prisma.$executeRawUnsafe(
        'INSERT INTO _erp_migration (name, checksum) VALUES (?, ?)',
        name,
        digest,
      )
    }
  } finally {
    await prisma.$queryRawUnsafe("SELECT RELEASE_LOCK('erp_schema_migration')")
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
