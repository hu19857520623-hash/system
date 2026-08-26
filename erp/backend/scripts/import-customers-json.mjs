/**
 * 生产环境客户导入（纯 Node，无 ts-node / xlsx 依赖）
 *
 * 用法:
 *   node scripts/import-customers-json.mjs                 # 预览
 *   node scripts/import-customers-json.mjs --apply           # 写入
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

async function findOmsAccount(customerCode) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT c.id, u.id AS portalUserId
     FROM oms_CustomerAccount c
     LEFT JOIN oms_PortalUser u ON u.customerId = c.id
     WHERE c.code = ?
     LIMIT 1`,
    customerCode,
  )
  return rows[0] || null
}

async function upsertCustomer(item, passwordHash, createPortal) {
  const now = new Date()
  const omsStatus = toOmsStatus(item.status)
  const accountId = stableOmsId('customer', item.customerCode)
  const billingId = stableOmsId('billing', item.customerCode)

  await prisma.customer.upsert({
    where: { customerCode: item.customerCode },
    create: {
      customerCode: item.customerCode,
      customerName: item.customerName,
      companyName: item.companyName,
      contactEmail: item.contactEmail,
      contactName: item.contactName,
      contactPhone: item.contactPhone,
      status: item.status,
      balance: Math.max(0, item.balance),
    },
    update: {
      customerName: item.customerName,
      companyName: item.companyName,
      contactEmail: item.contactEmail,
      contactName: item.contactName,
      contactPhone: item.contactPhone,
      status: item.status,
      balance: Math.max(0, item.balance),
    },
  })

  await prisma.$executeRawUnsafe(
    `INSERT INTO oms_CustomerAccount
      (id, name, code, type, contact, email, status, permissions, warehouse, createdAt, lastLoginAt, companyName, contactPhone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
     ON DUPLICATE KEY UPDATE
      name = VALUES(name), type = VALUES(type), contact = VALUES(contact), email = VALUES(email),
      status = VALUES(status), permissions = VALUES(permissions), warehouse = VALUES(warehouse),
      companyName = VALUES(companyName), contactPhone = VALUES(contactPhone)`,
    accountId,
    item.customerName,
    item.customerCode,
    PORTAL_TYPE,
    item.contactName || '',
    item.contactEmail || '',
    omsStatus,
    HYBRID_PERMISSIONS,
    WAREHOUSE,
    now.toISOString(),
    item.companyName,
    item.contactPhone,
  )

  await prisma.$executeRawUnsafe(
    `INSERT INTO oms_BillingAccount
      (id, customerId, name, code, contact, warehouse, creditBalance, monthlySpent, pendingBill, budgetUsed)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
     ON DUPLICATE KEY UPDATE
      name = VALUES(name), code = VALUES(code), contact = VALUES(contact),
      warehouse = VALUES(warehouse), creditBalance = VALUES(creditBalance)`,
    billingId,
    accountId,
    item.customerName,
    item.customerCode,
    item.contactName || '',
    WAREHOUSE,
    item.balance,
  )

  if (createPortal) {
    const portalUserId = stableOmsId('portal', item.customerCode)
    const ts = now.toISOString()
    await prisma.$executeRawUnsafe(
      `INSERT INTO oms_PortalUser
        (id, customerId, username, passwordHash, role, status, mustChangePassword, createdAt, updatedAt, lastLoginAt)
       VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE
        username = VALUES(username), passwordHash = VALUES(passwordHash), role = VALUES(role),
        status = VALUES(status), mustChangePassword = TRUE, updatedAt = VALUES(updatedAt)`,
      portalUserId,
      accountId,
      item.username,
      passwordHash,
      PORTAL_TYPE,
      omsStatus,
      ts,
      ts,
    )
  }

  if (item.balance !== Math.max(0, item.balance)) {
    await prisma.customer.update({
      where: { customerCode: item.customerCode },
      data: { balance: item.balance },
    })
  }
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
  let failed = 0

  for (const item of customers) {
    try {
      const existing = await prisma.customer.findUnique({
        where: { customerCode: item.customerCode },
        select: { id: true },
      })
      const account = await findOmsAccount(item.customerCode)
      const createPortal = !account?.portalUserId

      await upsertCustomer(item, passwordHash, createPortal)
      if (existing) {
        updated += 1
        console.log(`UPDATE ${item.customerCode} ${item.customerName}${createPortal ? ' +OMS' : ''}`)
      } else {
        created += 1
        console.log(`CREATE ${item.customerCode} ${item.customerName}`)
      }
    } catch (error) {
      failed += 1
      console.error(`FAIL ${item.customerCode}:`, error instanceof Error ? error.message : error)
    }
  }

  console.log(`\n完成：新建 ${created}，更新 ${updated}，失败 ${failed}`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
