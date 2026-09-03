import { Injectable, NotFoundException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PermissionsService } from '../../common/permissions/permissions.service'
import { PaginationDto, getPagination } from '../../common/dto/pagination.dto'
import { CreateUserDto, UpdateUserDto } from './dto/user.dto'
import { normalizeWorkstation } from '../outbound/outbound.policy'

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

  async list(q: PaginationDto & { roleCode?: string; status?: string }) {
    const { page, pageSize } = getPagination(q)
    const where: any = {}
    if (q.keyword) {
      where.OR = [
        { username: { contains: q.keyword } },
        { realName: { contains: q.keyword } },
        { workstation: { contains: q.keyword } },
      ]
    }
    if (q.roleCode) where.roleCode = q.roleCode
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
    const passwordHash = await bcrypt.hash(dto.password, 10)
    return this.prisma.sysUser.create({
      data: {
        username: dto.username, passwordHash, realName: dto.realName,
        roleCode: dto.roleCode, phone: dto.phone, email: dto.email,
        workstation: normalizeWorkstation(dto.workstation),
        status: dto.status ?? 1,
      },
      select: SELECT,
    })
  }

  async update(id: number, dto: UpdateUserDto) {
    await this.detail(id)
    const data: any = { ...dto }
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 10)
      delete data.password
    }
    if (dto.workstation !== undefined) {
      data.workstation = normalizeWorkstation(dto.workstation)
    }
    return this.prisma.sysUser.update({ where: { id: BigInt(id) }, data, select: SELECT })
  }

  async remove(id: number) {
    await this.detail(id)
    await this.prisma.sysUser.delete({ where: { id: BigInt(id) } })
    return { id }
  }

  roles() {
    return this.prisma.sysRole.findMany({ orderBy: { id: 'asc' } })
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
