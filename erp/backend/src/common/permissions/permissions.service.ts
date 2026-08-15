import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { defaultPermsForRoleCode, normalizePermCodes } from './permissions.constants'

@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

  async getUserPermissions(userId: number, roleCode: string): Promise<string[]> {
    const custom = await this.prisma.sysUserPermission.findMany({
      where: { userId: BigInt(userId) },
      select: { permCode: true },
    })
    if (custom.length > 0) {
      return normalizePermCodes(custom.map((r) => r.permCode))
    }

    const rolePerms = await this.prisma.sysRolePermission.findMany({
      where: { roleCode },
      select: { permCode: true },
    })
    if (rolePerms.length > 0) {
      return normalizePermCodes(rolePerms.map((r) => r.permCode))
    }

    return defaultPermsForRoleCode(roleCode)
  }

  async setUserPermissions(userId: number, permissions: string[]) {
    const codes = normalizePermCodes([...new Set(permissions.filter(Boolean))])
    await this.prisma.$transaction(async (tx) => {
      await tx.sysUserPermission.deleteMany({ where: { userId: BigInt(userId) } })
      if (codes.length) {
        await tx.sysUserPermission.createMany({
          data: codes.map((permCode) => ({ userId: BigInt(userId), permCode })),
        })
      }
    })
    return { userId, permissions: codes }
  }

  async clearUserPermissions(userId: number) {
    await this.prisma.sysUserPermission.deleteMany({ where: { userId: BigInt(userId) } })
    return { userId, permissions: [] }
  }

  async userHasPerm(userId: number, roleCode: string, perm: string): Promise<boolean> {
    if (roleCode === 'admin') return true
    const perms = await this.getUserPermissions(userId, roleCode)
    return perms.includes(perm)
  }

  async userHasAllPerms(userId: number, roleCode: string, required: string[]): Promise<boolean> {
    if (roleCode === 'admin') return true
    const perms = new Set(await this.getUserPermissions(userId, roleCode))
    return required.every((p) => perms.has(p))
  }

  async userHasAnyPerm(userId: number, roleCode: string, required: string[]): Promise<boolean> {
    if (roleCode === 'admin') return true
    const perms = new Set(await this.getUserPermissions(userId, roleCode))
    return required.some((p) => perms.has(p))
  }
}
