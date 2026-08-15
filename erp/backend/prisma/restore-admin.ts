/**
 * 仅恢复系统管理员账号（不写入演示业务数据）
 * 用法: npx ts-node prisma/restore-admin.ts
 */
import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import {
  ALL_PERM_CODES,
  ROLE_CODE_TEMPLATE,
  ROLE_PERM_TEMPLATES,
} from '../src/common/permissions/permissions.constants'

const prisma = new PrismaClient()
const DEFAULT_PASSWORD = '123456'

async function seedPermissions() {
  for (const permCode of ALL_PERM_CODES) {
    const module = permCode.split('.')[0]
    await prisma.sysPermission.upsert({
      where: { permCode },
      create: { permCode, permName: permCode, module },
      update: { permName: permCode, module },
    })
  }

  for (const [roleCode, templateKey] of Object.entries(ROLE_CODE_TEMPLATE)) {
    const perms = ROLE_PERM_TEMPLATES[templateKey] || []
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
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10)

  await prisma.sysRole.upsert({
    where: { roleCode: 'admin' },
    create: { roleCode: 'admin', roleName: '系统管理员', description: '拥有全部权限' },
    update: { roleName: '系统管理员', description: '拥有全部权限' },
  })

  await seedPermissions()
  console.log('✓ 管理员角色权限已同步')

  await prisma.sysUser.upsert({
    where: { username: 'admin' },
    create: {
      username: 'admin',
      realName: '系统管理员',
      roleCode: 'admin',
      passwordHash: hash,
      status: 1,
    },
    update: {
      realName: '系统管理员',
      roleCode: 'admin',
      passwordHash: hash,
      status: 1,
    },
  })

  console.log('✓ 管理员账号已恢复')
  console.log(`\n登录账号: admin`)
  console.log(`登录密码: ${DEFAULT_PASSWORD}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
