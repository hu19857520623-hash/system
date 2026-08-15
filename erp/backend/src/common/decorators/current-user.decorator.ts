import { createParamDecorator, ExecutionContext } from '@nestjs/common'

export interface AuthUser {
  userId: number
  username: string
  roleCode: string
  realName: string
}

/** 从请求中取出当前登录用户 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | any => {
    const request = ctx.switchToHttp().getRequest()
    const user = request.user as AuthUser
    return data ? user?.[data] : user
  },
)
