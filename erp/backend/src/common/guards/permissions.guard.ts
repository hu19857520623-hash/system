import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PERMS_ANY_KEY, PERMS_KEY } from '../decorators/require-perms.decorator'
import { PermissionsService } from '../permissions/permissions.service'

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredAll = this.reflector.getAllAndOverride<string[]>(PERMS_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    const requiredAny = this.reflector.getAllAndOverride<string[]>(PERMS_ANY_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if ((!requiredAll || requiredAll.length === 0) && (!requiredAny || requiredAny.length === 0)) {
      return true
    }

    const { user } = context.switchToHttp().getRequest()
    if (!user) throw new ForbiddenException('未认证')
    if (user.roleCode === 'admin') return true

    const userId = user.userId ?? user.sub
    const roleCode = user.roleCode

    if (requiredAll?.length) {
      const ok = await this.permissions.userHasAllPerms(userId, roleCode, requiredAll)
      if (!ok) throw new ForbiddenException('无权限执行此操作')
    }
    if (requiredAny?.length) {
      const ok = await this.permissions.userHasAnyPerm(userId, roleCode, requiredAny)
      if (!ok) throw new ForbiddenException('无权限执行此操作')
    }
    return true
  }
}
