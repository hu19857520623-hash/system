/**
 * 从 WMS 账号管理 Excel 导入系统用户
 * 用法: npx ts-node prisma/import-users-xlsx.ts [xlsx路径]
 */
import * as XLSX from 'xlsx'
import * as bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import {
  ROLE_CODE_TEMPLATE,
  ROLE_PERM_TEMPLATES,
} from '../src/common/permissions/permissions.constants'

const DEFAULT_XLSX =
  'c:\\Users\\15693\\Desktop\\UserListForSys账号管理_9f4a8df24ade4206ebce5cf55d9ccb6f_2026-07-03 14_03_16_826.xlsx'

const DEFAULT_PASSWORD = '123456'

const ROLE_DEFS: Record<string, { roleName: string; description: string }> = {
  admin: { roleName: '系统管理员', description: '拥有全部权限' },
  ops_manager: { roleName: '采购主管', description: '采购审核与分配' },
  purchaser: { roleName: '采购', description: '采购下单' },
  finance: { roleName: '财务', description: '财务审核与结算' },
  viewer: { roleName: '产品开发', description: '选品与开发' },
  dev_manager: { roleName: '产品开发主管', description: '产品审核' },
  warehouse: { roleName: '仓库', description: '入库与库存' },
  cs: { roleName: '销售', description: '线索跟进' },
  sales_manager: { roleName: '销售主管', description: '线索分配与团队管理' },
  coach: { roleName: '陪跑', description: '定价与 OMS' },
  coach1: { roleName: '陪跑1', description: '店铺监控 1-5' },
  coach2: { roleName: '陪跑2', description: '店铺监控 6-9,0' },
}

function cellStr(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function normalizeUsername(userCode: string, fallback: string): string {
  const raw = (userCode || fallback).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
  return (raw || fallback.trim().toLowerCase()).slice(0, 50)
}

function mapRole(roleRaw: string): string {
  const s = cellStr(roleRaw)
  if (!s) return 'viewer'
  if (s.includes('开发管理') || (s.includes('产品开发') && s.includes('管理'))) return 'dev_manager'
  if (s === '管理' || (s.includes('管理') && !s.includes('采购') && !s.includes('开发'))) return 'admin'
  if (s.includes('采购管理') || s.includes('采购主管')) return 'ops_manager'
  if (s.includes('销售主管') || s.includes('销售管理')) return 'sales_manager'
  if (s.includes('财务')) return 'finance'
  if (s.includes('美工')) return 'viewer'
  if (s.includes('产品开发')) return 'viewer'
  if (s.includes('陪跑1') || s === 'coach1') return 'coach1'
  if (s.includes('陪跑2') || s === 'coach2') return 'coach2'
  if (s.includes('采购')) return 'purchaser'
  if (s.includes('仓库')) return 'warehouse'
  if (s.includes('销售') || s.includes('客服')) return 'cs'
  return 'viewer'
}

function parseDateTime(v: unknown): Date | undefined {
  const s = cellStr(v)
  if (!s || s.startsWith('0000')) return undefined
  const d = new Date(s.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? undefined : d
}

function trunc(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max)
}

async function ensureRoles(prisma: PrismaClient, roleCodes: Set<string>) {
  for (const roleCode of roleCodes) {
    const def = ROLE_DEFS[roleCode] || { roleName: roleCode, description: '' }
    await prisma.sysRole.upsert({
      where: { roleCode },
      create: { roleCode, roleName: def.roleName, description: def.description },
      update: { roleName: def.roleName, description: def.description },
    })

    const templateKey = ROLE_CODE_TEMPLATE[roleCode]
    const perms = templateKey ? ROLE_PERM_TEMPLATES[templateKey] || [] : []
    await prisma.sysRolePermission.deleteMany({ where: { roleCode } })
    if (perms.length) {
      await prisma.sysRolePermission.createMany({
        data: perms.map((permCode) => ({ roleCode, permCode })),
        skipDuplicates: true,
      })
    }
  }
}

async function main() {
  const xlsxPath = process.argv[2] || DEFAULT_XLSX
  console.log(`读取 Excel: ${xlsxPath}`)

  const wb = XLSX.readFile(xlsxPath, { cellDates: true })
  const ws = wb.Sheets['UserListForSys'] || wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('未找到工作表 UserListForSys')

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
  if (!rows.length) throw new Error('Excel 无数据行')

  const prisma = new PrismaClient()
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10)

  const roleCodes = new Set<string>()
  for (const row of rows) {
    roleCodes.add(mapRole(cellStr(row['角色'])))
  }
  await ensureRoles(prisma, roleCodes)
  console.log(`✓ 角色已同步 (${roleCodes.size} 个)\n`)

  let created = 0
  let updated = 0
  let skipped = 0

  for (const row of rows) {
    const realName = trunc(cellStr(row['姓名']), 50)
    const userCode = cellStr(row['用户代码'])
    const fallbackUser = cellStr(row['用户名'])
    const username = normalizeUsername(userCode, fallbackUser)

    if (!username || !realName) {
      skipped++
      console.warn('  跳过：缺少用户名或姓名', row)
      continue
    }

    // 保留 restore-admin 创建的 admin 账号，不覆盖
    if (username === 'admin') {
      skipped++
      console.log(`  - 跳过已有管理员: ${realName} (${username})`)
      continue
    }

    const roleCode = mapRole(cellStr(row['角色']))
    const statusRaw = cellStr(row['状态(1:启用,0:禁用)'])
    const status = statusRaw === '0' ? 0 : 1
    const phone = trunc(cellStr(row['手机号']), 20) || undefined
    const email = trunc(cellStr(row['邮箱地址']), 100) || undefined
    const lastLoginAt = parseDateTime(row['最后一次登录时间'])

    const data = {
      username,
      realName,
      roleCode,
      passwordHash,
      phone,
      email,
      status,
      lastLoginAt,
    }

    const exists = await prisma.sysUser.findUnique({ where: { username } })
    if (exists) {
      await prisma.sysUser.update({
        where: { username },
        data: {
          realName: data.realName,
          roleCode: data.roleCode,
          phone: data.phone,
          email: data.email,
          status: data.status,
          lastLoginAt: data.lastLoginAt,
        },
      })
      updated++
      console.log(`  ↻ 更新: ${username} ${realName} [${ROLE_DEFS[roleCode]?.roleName || roleCode}]`)
    } else {
      await prisma.sysUser.create({ data })
      created++
      console.log(`  ✓ 新增: ${username} ${realName} [${ROLE_DEFS[roleCode]?.roleName || roleCode}]`)
    }
  }

  const total = await prisma.sysUser.count()
  console.log(`\n完成：新增 ${created}，更新 ${updated}，跳过 ${skipped}`)
  console.log(`当前用户总数: ${total}（含 admin）`)
  console.log(`初始密码: ${DEFAULT_PASSWORD}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
