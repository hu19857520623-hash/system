import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { AuthUser } from '../../common/decorators/current-user.decorator'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') || 'takealot-erp-secret',
    })
  }

  async validate(payload: any): Promise<AuthUser> {
    return {
      userId: payload.sub,
      username: payload.username,
      roleCode: payload.roleCode,
      realName: payload.realName,
    }
  }
}
