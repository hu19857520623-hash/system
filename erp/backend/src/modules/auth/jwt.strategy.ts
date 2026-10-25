import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { AuthUser } from '../../common/decorators/current-user.decorator'
import { PrismaService } from '../../common/prisma/prisma.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: (() => {
        const secret = String(config.get<string>('JWT_SECRET') || '').trim()
        if (!secret) throw new Error('JWT_SECRET is required')
        return secret
      })(),
    })
  }

  async validate(payload: any): Promise<AuthUser> {
    const sub = payload?.sub
    const id = typeof sub === 'string' && /^[1-9]\d*$/.test(sub) ? Number(sub) : sub
    if (!Number.isSafeInteger(id) || id <= 0) throw new UnauthorizedException('登录信息无效，请重新登录')
    const user = await this.prisma.sysUser.findUnique({
      where: { id: BigInt(id) },
      select: { id: true, username: true, realName: true, roleCode: true, status: true },
    })
    if (!user || user.status !== 1) throw new UnauthorizedException('账号已停用或不存在，请联系管理员核对后重新登录')
    return {
      userId: Number(user.id),
      username: user.username,
      roleCode: user.roleCode,
      realName: user.realName,
    }
  }
}
