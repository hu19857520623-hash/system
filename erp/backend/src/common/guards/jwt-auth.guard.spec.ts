import { UnauthorizedException } from '@nestjs/common'
import { JwtAuthGuard } from './jwt-auth.guard'

describe('JwtAuthGuard.handleRequest', () => {
  const guard = new JwtAuthGuard({ getAllAndOverride: () => false } as any)

  it('returns the user when JWT is valid', () => {
    const user = { userId: 1, username: 'wh', roleCode: 'inbound_clerk', realName: '仓管' }
    expect(guard.handleRequest(undefined, user, undefined)).toBe(user)
  })

  it('maps expired tokens to a Chinese login message', () => {
    expect(() => guard.handleRequest(undefined, undefined as never, { name: 'TokenExpiredError' })).toThrow(
      UnauthorizedException,
    )
    try {
      guard.handleRequest(undefined, undefined as never, { name: 'TokenExpiredError' })
    } catch (error) {
      expect((error as UnauthorizedException).message).toBe('登录已过期，请重新登录')
    }
  })

  it('maps missing tokens to a Chinese login message', () => {
    try {
      guard.handleRequest(undefined, undefined as never, { message: 'No auth token' })
    } catch (error) {
      expect((error as UnauthorizedException).message).toBe('未登录或登录已失效，请重新登录')
    }
  })
})
