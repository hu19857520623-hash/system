/**
 * 仅同步权限目录到 sys_permission / sys_role_permission（不跑全量 seed）
 */
import { PrismaClient } from '@prisma/client'
import {
  ALL_PERM_CODES,
  ROLE_CODE_TEMPLATE,
  ROLE_PERM_TEMPLATES,
  permLabel,
  permModule,
} from '../../shared/permissions.catalog'

const prisma = new PrismaClient()

async function main() {
  for (const permCode of ALL_PERM_CODES) {
    await prisma.sysPermission.upsert({
      where: { permCode },
      create: { permCode, permName: permLabel(permCode), module: permModule(permCode) },
      update: { permName: permLabel(permCode), module: permModule(permCode) },
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

  console.log(`✓ 权限已同步 (${ALL_PERM_CODES.length} 项，含 outbound.*)`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
