import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PermissionsService } from '../../common/permissions/permissions.service'
import { LoginDto } from './dto/login.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { ChangePasswordDto } from './dto/change-password.dto'
import { LoginRateLimiter } from './login-rate-limit'

@Injectable()
export class AuthService {
  private readonly loginLimiter = new LoginRateLimiter()

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private permissions: PermissionsService,
  ) {}

  async login(dto: LoginDto, clientKey = 'unknown') {
    const rateKey = `${clientKey}:${String(dto.username || '').trim().toLowerCase()}`
    try {
      this.loginLimiter.assertAllowed(rateKey)
    } catch (error) {
      if ((error as { status?: number }).status === 429) {
        throw new HttpException((error as Error).message, HttpStatus.TOO_MANY_REQUESTS)
      }
      throw error
    }

    const user = await this.prisma.sysUser.findUnique({ where: { username: dto.username } })
    if (!user) {
      this.loginLimiter.recordFailure(rateKey)
      throw new UnauthorizedException('用户名或密码错误')
    }
    if (user.status !== 1) throw new UnauthorizedException('账号已被禁用')

    const ok = await bcrypt.compare(dto.password, user.passwordHash)
    if (!ok) {
      this.loginLimiter.recordFailure(rateKey)
      throw new UnauthorizedException('用户名或密码错误')
    }

    this.loginLimiter.recordSuccess(rateKey)
    await this.prisma.sysUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    return this.buildAuthResponse(user)
  }

  private async buildAuthResponse(user: {
    id: bigint
    username: string
    realName: string
    roleCode: string
    workstation?: string | null
    avatarUrl: string | null
  }) {
    const permissions = await this.permissions.getUserPermissions(Number(user.id), user.roleCode)
    const payload = {
      sub: Number(user.id),
      username: user.username,
      roleCode: user.roleCode,
      realName: user.realName,
    }
    return {
      token: await this.jwt.signAsync(payload),
      user: {
        id: Number(user.id),
        username: user.username,
        realName: user.realName,
        roleCode: user.roleCode,
        workstation: user.workstation || null,
        avatarUrl: user.avatarUrl,
        permissions,
      },
    }
  }

  async profile(userId: number) {
    const user = await this.prisma.sysUser.findUnique({ where: { id: BigInt(userId) } })
    if (!user) throw new UnauthorizedException('用户不存在')
    const role = await this.prisma.sysRole.findUnique({ where: { roleCode: user.roleCode } })
    const permissions = await this.permissions.getUserPermissions(userId, user.roleCode)
    return {
      id: Number(user.id),
      username: user.username,
      realName: user.realName,
      phone: user.phone,
      email: user.email,
      avatarUrl: user.avatarUrl,
      roleCode: user.roleCode,
      roleName: role?.roleName ?? user.roleCode,
      workstation: user.workstation || null,
      lastLoginAt: user.lastLoginAt,
      permissions,
    }
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    const user = await this.prisma.sysUser.findUnique({ where: { id: BigInt(userId) } })
    if (!user) throw new UnauthorizedException('用户不存在')

    const data: { realName?: string; phone?: string | null; email?: string | null } = {}
    if (dto.realName !== undefined) {
      const name = dto.realName.trim()
      if (!name) throw new BadRequestException('姓名不能为空')
      data.realName = name
    }
    if (dto.phone !== undefined) data.phone = dto.phone.trim() || null
    if (dto.email !== undefined) data.email = dto.email.trim() || null

    await this.prisma.sysUser.update({
      where: { id: BigInt(userId) },
      data,
    })

    return this.profile(userId)
  }

  async changePassword(userId: number, dto: ChangePasswordDto) {
    const user = await this.prisma.sysUser.findUnique({ where: { id: BigInt(userId) } })
    if (!user) throw new UnauthorizedException('用户不存在')

    const ok = await bcrypt.compare(dto.oldPassword, user.passwordHash)
    if (!ok) throw new UnauthorizedException('当前密码不正确')

    const passwordHash = await bcrypt.hash(dto.newPassword, 10)
    await this.prisma.sysUser.update({
      where: { id: BigInt(userId) },
      data: { passwordHash },
    })

    return { ok: true }
  }
}
