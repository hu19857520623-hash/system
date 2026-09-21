import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuthGuard } from '@nestjs/passport'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super()
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true
    return super.canActivate(context)
  }

  handleRequest<TUser>(err: Error | undefined, user: TUser, info: { name?: string; message?: string } | undefined): TUser {
    if (err) throw err
    if (user) return user
    const expired =
      info?.name === 'TokenExpiredError' ||
      String(info?.message || '').toLowerCase().includes('expired')
    throw new UnauthorizedException(expired ? '登录已过期，请重新登录' : '未登录或登录已失效，请重新登录')
  }
}
