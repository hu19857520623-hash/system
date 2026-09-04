import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PermissionsService } from '../../common/permissions/permissions.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { CreateUserDto, UpdateUserDto } from './dto/user.dto'
import { normalizeWorkstation } from '../outbound/outbound.policy'
import {
  ROLE_DEFINITIONS,
  catalogRoleName,
  isKnownRoleCode,
  isWarehouseStaffRole,
  roleCodesBySide,
  roleSide,
  type RoleSide,
} from '@erp/shared/permissions.catalog'

const SELECT = {
  id: true, username: true, realName: true, phone: true, email: true,
  avatarUrl: true, roleCode: true, workstation: true, status: true, lastLoginAt: true, createdAt: true,
}

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private permissions: PermissionsService,
  ) {}

  async list(q: PaginationDto & { roleCode?: string; status?: string; roleSide?: string }) {
    const { page, pageSize } = getPagination(q)
    const where: any = {}
    if (q.keyword) {
      where.OR = [
        { username: { contains: q.keyword } },
        { realName: { contains: q.keyword } },
        { workstation: { contains: q.keyword } },
      ]
    }
    const side = this.parseRoleSide(q.roleSide)
    if (q.roleCode && side && roleSide(q.roleCode) !== side) {
      return { items: [], total: 0, page, pageSize }
    }
    if (q.roleCode) where.roleCode = q.roleCode
    else if (side) where.roleCode = { in: roleCodesBySide(side) }
    if (q.status === 'active') where.status = 1
    else if (q.status === 'disabled') where.status = 0
    const [rows, total] = await Promise.all([
      this.prisma.sysUser.findMany({ where, select: SELECT, skip: (page - 1) * pageSize, take: pageSize, orderBy: { id: 'desc' } }),
      this.prisma.sysUser.count({ where }),
    ])
    const ids = rows.map((u) => u.id)
    const customRows = ids.length
      ? await this.prisma.sysUserPermission.findMany({
          where: { userId: { in: ids } },
          select: { userId: true },
        })
      : []
    const customSet = new Set(customRows.map((r) => Number(r.userId)))
    const items = rows.map((u) => ({
      ...u,
      id: Number(u.id),
      roleName: catalogRoleName(u.roleCode),
      roleSide: roleSide(u.roleCode),
      hasCustomPermissions: customSet.has(Number(u.id)),
    }))
    return { items, total, page, pageSize }
  }

  async detail(id: number) {
    const user = await this.prisma.sysUser.findUnique({ where: { id: BigInt(id) }, select: SELECT })
    if (!user) throw new NotFoundException('用户不存在')
    return user
  }

  async create(dto: CreateUserDto) {
    this.assertKnownRole(dto.roleCode)
    const passwordHash = await bcrypt.hash(dto.password, 10)
    return this.prisma.sysUser.create({
      data: {
        username: dto.username, passwordHash, realName: dto.realName,
        roleCode: dto.roleCode, phone: dto.phone, email: dto.email,
        workstation: isWarehouseStaffRole(dto.roleCode) ? normalizeWorkstation(dto.workstation) : null,
        status: dto.status ?? 1,
      },
      select: SELECT,
    })
  }

  async update(id: number, dto: UpdateUserDto) {
    const current = await this.detail(id)
    if (dto.roleCode) this.assertKnownRole(dto.roleCode)
    const data: any = { ...dto }
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 10)
      delete data.password
    }
    const nextRole = dto.roleCode || current.roleCode
    if (!isWarehouseStaffRole(nextRole)) {
      data.workstation = null
    } else if (dto.workstation !== undefined) {
      data.workstation = normalizeWorkstation(dto.workstation)
    }
    return this.prisma.sysUser.update({ where: { id: BigInt(id) }, data, select: SELECT })
  }

  async remove(id: number) {
    await this.detail(id)
    await this.prisma.sysUser.delete({ where: { id: BigInt(id) } })
    return { id }
  }

  async roles() {
    const rows = await this.prisma.sysRole.findMany({ orderBy: { id: 'asc' } })
    const byCode = new Map(rows.map((r) => [r.roleCode, r]))
    return ROLE_DEFINITIONS.map((def) => {
      const row = byCode.get(def.roleCode)
      return {
        id: row ? Number(row.id) : null,
        roleCode: def.roleCode,
        roleName: def.roleName,
        description: def.description,
        side: def.side,
      }
    })
  }

  private assertKnownRole(roleCode: string) {
    if (!isKnownRoleCode(roleCode)) throw new BadRequestException('无效职位')
  }

  private parseRoleSide(raw?: string): RoleSide | null {
    if (raw === 'office' || raw === 'warehouse' || raw === 'system') return raw
    return null
  }

  getPermissions(userId: number) {
    return this.detail(userId).then(async (user) => {
      const permissions = await this.permissions.getUserPermissions(userId, user.roleCode)
      return { userId, permissions }
    })
  }

  setPermissions(userId: number, permissions: string[]) {
    return this.detail(userId).then(() => this.permissions.setUserPermissions(userId, permissions))
  }

  async resetPermissionsToRole(userId: number) {
    const user = await this.detail(userId)
    await this.permissions.clearUserPermissions(userId)
    const permissions = await this.permissions.getUserPermissions(userId, user.roleCode)
    return { userId, permissions }
  }
}
