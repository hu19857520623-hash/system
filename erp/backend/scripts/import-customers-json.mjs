/**
 * 生产环境客户导入（纯 Node，无 ts-node / xlsx 依赖）
 *
 * 用法:
 *   node scripts/import-customers-json.mjs                 # 预览
 *   node scripts/import-customers-json.mjs --apply         # 写入 ERP + OMS
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_FILE = join(__dirname, '../data/customers-import.json')
const DEFAULT_PASSWORD = process.env.IMPORT_DEFAULT_PASSWORD || 'ChangeMe123!'
const PORTAL_TYPE = 'hybrid'
const WAREHOUSE = 'jhb1'
const HYBRID_PERMISSIONS = JSON.stringify([
  'dashboard:read', 'order:read', 'order:write', 'order:export',
  'catalog:read', 'catalog:write', 'product:read', 'product:write',
  'code:read', 'code:apply', 'code:approve', 'platform:read', 'platform:write',
  'inbound:read', 'inbound:write', 'outbound:read', 'outbound:write',
  'inventory:read', 'logistics:read', 'returns:read', 'returns:write',
  'billing:read', 'billing:recharge', 'store:manage', 'report:read',
])

const prisma = new PrismaClient()

function stableOmsId(kind, customerCode) {
  return `erp-${kind}-${customerCode.trim().toLowerCase()}`
}

function toOmsStatus(status) {
  return status === 1 ? 'active' : 'disabled'
}

function sqlText(value) {
  return value == null ? null : String(value)
}

async function findOmsAccount(customerCode) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT c.id, u.id AS portalUserId
     FROM \`oms_CustomerAccount\` c
     LEFT JOIN \`oms_PortalUser\` u ON u.customerId = c.id
     WHERE c.code = ?
     LIMIT 1`,
    customerCode,
  )
  return rows[0] || null
}

async function upsertOmsAccount(item, omsStatus, accountId, nowIso) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO \`oms_CustomerAccount\`
      (\`id\`, \`name\`, \`code\`, \`type\`, \`contact\`, \`email\`, \`status\`,
       \`permissions\`, \`warehouse\`, \`createdAt\`, \`lastLoginAt\`,
       \`companyName\`, \`contactPhone\`)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      \`name\` = VALUES(\`name\`),
      \`type\` = VALUES(\`type\`),
      \`contact\` = VALUES(\`contact\`),
      \`email\` = VALUES(\`email\`),
      \`status\` = VALUES(\`status\`),
      \`permissions\` = VALUES(\`permissions\`),
      \`warehouse\` = VALUES(\`warehouse\`),
      \`companyName\` = VALUES(\`companyName\`),
      \`contactPhone\` = VALUES(\`contactPhone\`)`,
    accountId,
    item.customerName,
    item.customerCode,
    PORTAL_TYPE,
    sqlText(item.contactName) || '',
    sqlText(item.contactEmail) || '',
    omsStatus,
    HYBRID_PERMISSIONS,
    WAREHOUSE,
    nowIso,
    '',
    sqlText(item.companyName),
    sqlText(item.contactPhone),
  )
}

async function upsertBillingAccount(item, accountId) {
  const billingId = stableOmsId('billing', item.customerCode)
  const creditBalance = Number.isFinite(Number(item.balance)) ? Number(item.balance) : 0
  await prisma.$executeRawUnsafe(
    `INSERT INTO \`oms_BillingAccount\`
      (\`id\`, \`customerId\`, \`name\`, \`code\`, \`contact\`, \`warehouse\`,
       \`creditBalance\`, \`monthlySpent\`, \`pendingBill\`, \`budgetUsed\`)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
     ON DUPLICATE KEY UPDATE
      \`name\` = VALUES(\`name\`),
      \`code\` = VALUES(\`code\`),
      \`contact\` = VALUES(\`contact\`),
      \`warehouse\` = VALUES(\`warehouse\`),
      \`creditBalance\` = VALUES(\`creditBalance\`)`,
    billingId,
    accountId,
    item.customerName,
    item.customerCode,
    sqlText(item.contactName) || '',
    WAREHOUSE,
    creditBalance,
  )
}

async function upsertPortalUser(accountId, item, passwordHash, omsStatus, nowIso) {
  const portalUserId = stableOmsId('portal', item.customerCode)
  await prisma.$executeRawUnsafe(
    `INSERT INTO \`oms_PortalUser\`
      (\`id\`, \`customerId\`, \`username\`, \`passwordHash\`, \`role\`, \`status\`,
       \`mustChangePassword\`, \`createdAt\`, \`updatedAt\`, \`lastLoginAt\`)
     VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
      \`username\` = VALUES(\`username\`),
      \`passwordHash\` = VALUES(\`passwordHash\`),
      \`role\` = VALUES(\`role\`),
      \`status\` = VALUES(\`status\`),
      \`mustChangePassword\` = TRUE,
      \`updatedAt\` = VALUES(\`updatedAt\`)`,
    portalUserId,
    accountId,
    item.username,
    passwordHash,
    PORTAL_TYPE,
    omsStatus,
    nowIso,
    nowIso,
  )
}

async function upsertCustomer(item, passwordHash, createPortal) {
  const nowIso = new Date().toISOString()
  const omsStatus = toOmsStatus(item.status)
  const accountId = stableOmsId('customer', item.customerCode)
  const normalizedBalance = Number.isFinite(Number(item.balance)) ? Number(item.balance) : 0

  await prisma.customer.upsert({
    where: { customerCode: item.customerCode },
    create: {
      customerCode: item.customerCode,
      customerName: item.customerName,
      companyName: item.companyName ?? null,
      contactEmail: item.contactEmail ?? null,
      contactName: item.contactName ?? null,
      contactPhone: item.contactPhone ?? null,
      status: item.status,
      balance: Math.max(0, normalizedBalance),
    },
    update: {
      customerName: item.customerName,
      companyName: item.companyName ?? null,
      contactEmail: item.contactEmail ?? null,
      contactName: item.contactName ?? null,
      contactPhone: item.contactPhone ?? null,
      status: item.status,
      balance: Math.max(0, normalizedBalance),
    },
  })

  await upsertOmsAccount(item, omsStatus, accountId, nowIso)
  await upsertBillingAccount(item, accountId)

  if (createPortal) {
    await upsertPortalUser(accountId, item, passwordHash, omsStatus, nowIso)
  }

  if (normalizedBalance !== Math.max(0, normalizedBalance)) {
    await prisma.customer.update({
      where: { customerCode: item.customerCode },
      data: { balance: normalizedBalance },
    })
  }
}

async function countOmsLinkedCustomers() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(DISTINCT c.code) AS total
     FROM \`oms_CustomerAccount\` c
     INNER JOIN \`customer\` e ON e.customer_code = c.code`,
  )
  return Number(rows[0]?.total ?? 0)
}

async function main() {
  const apply = process.argv.includes('--apply')
  const customers = JSON.parse(readFileSync(DATA_FILE, 'utf8'))
  console.log(`读取 ${customers.length} 条客户: ${DATA_FILE}`)
  console.log(`模式: ${apply ? '写入数据库' : '仅预览'}`)
  if (!apply) {
    console.log(JSON.stringify(customers.slice(0, 3), null, 2))
    return
  }

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12)
  let created = 0
  let updated = 0
  let omsProvisioned = 0
  let failed = 0

  for (const item of customers) {
    try {
      const existing = await prisma.customer.findUnique({
        where: { customerCode: item.customerCode },
        select: { id: true },
      })
      const account = await findOmsAccount(item.customerCode)
      const needsOms = !account?.id
      const createPortal = !account?.portalUserId

      await upsertCustomer(item, passwordHash, createPortal)
      if (needsOms || createPortal) omsProvisioned += 1

      if (existing) {
        updated += 1
        console.log(`UPDATE ${item.customerCode} ${item.customerName}${needsOms || createPortal ? ' +OMS' : ''}`)
      } else {
        created += 1
        console.log(`CREATE ${item.customerCode} ${item.customerName}`)
      }
    } catch (error) {
      failed += 1
      const detail = error instanceof Error ? error.message : String(error)
      console.error(`FAIL ${item.customerCode}: ${detail}`)
      if (error && typeof error === 'object' && 'meta' in error) {
        console.error(JSON.stringify(error.meta))
      }
    }
  }

  const linked = await countOmsLinkedCustomers()
  console.log(`\n完成：新建 ${created}，更新 ${updated}，OMS 开通 ${omsProvisioned}，失败 ${failed}`)
  console.log(`OMS 已关联 ERP 客户数：${linked}`)

  if (failed > 0) process.exit(1)
  if (linked < 200) {
    console.error(`OMS 关联客户不足 200（当前 ${linked}），导入未达标`)
    process.exit(1)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
