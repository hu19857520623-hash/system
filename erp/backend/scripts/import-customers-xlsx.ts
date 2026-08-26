/**
 * 从「客户信息.xlsx」(bizExportCustomerInfo) 导入 ERP 客户 + OMS 账户。
 *
 * 用法（在 erp/backend 目录）:
 *   npx ts-node -r tsconfig-paths/register scripts/import-customers-xlsx.ts [xlsx路径]           # 预览
 *   npx ts-node -r tsconfig-paths/register scripts/import-customers-xlsx.ts [xlsx路径] --apply   # 写入数据库
 *
 * 环境变量:
 *   DATABASE_URL            目标数据库（本地或云服务器 MySQL）
 *   IMPORT_DEFAULT_PASSWORD  新开 OMS 门户的临时密码，默认 ChangeMe123!
 */
import { ConflictException } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import * as XLSX from 'xlsx'
import { join } from 'path'
import { AppModule } from '../src/app.module'
import { CustomersModule } from '../src/modules/customers/customers.module'
import { CustomersService } from '../src/modules/customers/customers.service'
import { PrismaService } from '../src/common/prisma/prisma.service'
import type { CreateCustomerDto } from '../src/modules/customers/dto/customer.dto'

const DEFAULT_XLSX = join(__dirname, '../data/customer-info.xlsx')
const DEFAULT_PASSWORD = process.env.IMPORT_DEFAULT_PASSWORD || 'ChangeMe123!'

type ExcelRow = Record<string, unknown>

type ParsedCustomer = {
  customerCode: string
  customerName: string
  companyName?: string
  contactEmail?: string
  contactName?: string
  contactPhone?: string
  balance: number
  status: number
  username: string
}

function cellStr(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function parseMoney(value: unknown): number {
  const raw = cellStr(value).replace(/,/g, '')
  if (!raw) return 0
  const num = Number(raw)
  return Number.isFinite(num) ? num : 0
}

function parseStatus(value: unknown): number {
  const raw = cellStr(value)
  if (!raw) return 1
  if (raw.includes('通过') || raw.includes('正常') || raw.includes('启用')) return 1
  if (raw.includes('禁用') || raw.includes('拒绝') || raw.includes('停用')) return 0
  return 1
}

function sanitizePhone(value: unknown): string | undefined {
  const phone = cellStr(value)
  if (!phone || phone === '1' || phone === '0' || phone.length < 3) return undefined
  return phone.slice(0, 30)
}

function deriveUsername(customerCode: string, email: string): string {
  const local = email.split('@')[0]?.trim().toLowerCase() || ''
  const fromEmail = local.replace(/[^a-z0-9._-]/g, '')
  if (fromEmail.length >= 6 && fromEmail.length <= 50) return fromEmail

  const fromCode = customerCode.trim().toLowerCase()
  if (fromCode.length >= 6 && fromCode.length <= 50 && /^[a-z0-9._-]+$/.test(fromCode)) {
    return fromCode
  }

  const padded = `${fromCode}01`.replace(/[^a-z0-9._-]/g, '').slice(0, 50)
  if (padded.length >= 6) return padded
  throw new Error(`无法为客户 ${customerCode} 生成合法 OMS 登录账号`)
}

function parseRow(row: ExcelRow): ParsedCustomer | null {
  const customerCode = cellStr(row['客户代码']).toUpperCase()
  if (!customerCode) return null

  const contactName = cellStr(row['名']) || cellStr(row['姓']) || undefined
  const companyName = cellStr(row['公司名称']) || undefined
  const customerName = contactName || companyName || customerCode
  const contactEmail = cellStr(row['邮箱']).toLowerCase() || undefined
  if (!contactEmail || !contactEmail.includes('@')) {
    throw new Error(`客户 ${customerCode} 缺少有效邮箱`)
  }

  return {
    customerCode,
    customerName: customerName.slice(0, 200),
    companyName: companyName?.slice(0, 200),
    contactEmail: contactEmail.slice(0, 120),
    contactName: contactName?.slice(0, 50),
    contactPhone: sanitizePhone(row['电话']),
    balance: parseMoney(row['可用余额']),
    status: parseStatus(row['注册状态']),
    username: deriveUsername(customerCode, contactEmail),
  }
}

function loadCustomers(xlsxPath: string): ParsedCustomer[] {
  const workbook = XLSX.readFile(xlsxPath, { cellDates: true })
  const sheetName = workbook.SheetNames.find((name) => name.includes('Customer'))
    || workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error(`Excel 中未找到工作表: ${sheetName}`)

  const rows = XLSX.utils.sheet_to_json<ExcelRow>(sheet, { defval: '' })
  const parsed: ParsedCustomer[] = []
  for (const row of rows) {
    const customer = parseRow(row)
    if (customer) parsed.push(customer)
  }
  const codes = parsed.map((item) => item.customerCode)
  if (new Set(codes).size !== codes.length) {
    throw new Error('Excel 中存在重复客户代码')
  }
  return parsed
}

function toCreateDto(item: ParsedCustomer): CreateCustomerDto {
  return {
    customerCode: item.customerCode,
    customerName: item.customerName,
    companyName: item.companyName,
    contactEmail: item.contactEmail,
    contactName: item.contactName,
    contactPhone: item.contactPhone,
    status: item.status,
    balance: Math.max(0, item.balance),
    portalType: 'hybrid',
    warehouse: 'jhb1',
    permissionTemplate: 'hybrid',
    username: item.username,
    temporaryPassword: DEFAULT_PASSWORD,
  }
}

async function syncBalance(
  prisma: PrismaService,
  customerCode: string,
  balance: number,
) {
  await prisma.customer.update({
    where: { customerCode },
    data: { balance },
  })
  await prisma.$executeRawUnsafe(
    `UPDATE \`oms_BillingAccount\` ba
     INNER JOIN \`oms_CustomerAccount\` ca ON ca.id = ba.customerId
     SET ba.creditBalance = ?
     WHERE ca.code = ?`,
    balance,
    customerCode,
  )
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
  const apply = process.argv.includes('--apply')
  const xlsxPath = args[0] || DEFAULT_XLSX
  const customers = loadCustomers(xlsxPath)

  console.log(`读取 ${customers.length} 条客户记录: ${xlsxPath}`)
  console.log(`模式: ${apply ? '写入数据库' : '仅预览（追加 --apply 才会导入）'}`)
  console.log(`新开 OMS 门户临时密码: ${DEFAULT_PASSWORD}`)

  if (!apply) {
    console.log('\n前 5 条映射预览:')
    for (const item of customers.slice(0, 5)) {
      console.log(JSON.stringify(item))
    }
    return
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })
  const customersService = app.select(CustomersModule).get(CustomersService)
  const prisma = app.get(PrismaService)

  let created = 0
  let updated = 0
  let failed = 0

  try {
    for (const item of customers) {
      try {
        const existing = await prisma.customer.findUnique({
          where: { customerCode: item.customerCode },
          select: { id: true },
        })
        const omsRows = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM \`oms_CustomerAccount\` WHERE code = ${item.customerCode} LIMIT 1
        `
        const hasOms = omsRows.length > 0

        if (!existing) {
          await customersService.create(toCreateDto(item))
          if (item.balance < 0) {
            await syncBalance(prisma, item.customerCode, item.balance)
          }
          created += 1
          console.log(`CREATE ${item.customerCode} ${item.customerName} balance=${item.balance}`)
          continue
        }

        const updatePayload = {
          customerName: item.customerName,
          companyName: item.companyName,
          contactEmail: item.contactEmail,
          contactName: item.contactName,
          contactPhone: item.contactPhone,
          status: item.status,
          balance: Math.max(0, item.balance),
          portalType: 'hybrid' as const,
          warehouse: 'jhb1',
          permissionTemplate: 'hybrid' as const,
          ...(hasOms
            ? {}
            : {
                username: item.username,
                temporaryPassword: DEFAULT_PASSWORD,
              }),
        }

        await customersService.update(Number(existing.id), updatePayload)
        await syncBalance(prisma, item.customerCode, item.balance)
        updated += 1
        console.log(`UPDATE ${item.customerCode} ${item.customerName} balance=${item.balance}`)
      } catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : String(error)
        if (error instanceof ConflictException) {
          console.error(`FAIL ${item.customerCode} 冲突: ${message}`)
        } else {
          console.error(`FAIL ${item.customerCode}: ${message}`)
        }
      }
    }
  } finally {
    await app.close()
  }

  console.log(`\n完成：新建 ${created}，更新 ${updated}，失败 ${failed}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
