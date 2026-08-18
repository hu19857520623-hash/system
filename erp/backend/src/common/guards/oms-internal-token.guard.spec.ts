import { UnauthorizedException } from '@nestjs/common'
import { OmsInternalTokenGuard } from './oms-internal-token.guard'

function contextWithHeader(token?: string, headerName = 'x-oms-internal-token') {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) => name === headerName ? token : undefined,
      }),
    }),
  } as any
}

function config(values: Record<string, string | undefined>) {
  return {
    get: (key: string) => values[key],
  } as any
}

describe('OmsInternalTokenGuard', () => {
  it('fails closed when OMS_INTERNAL_TOKEN is unset', () => {
    const guard = new OmsInternalTokenGuard(config({}))
    expect(() => guard.canActivate(contextWithHeader('supplied'))).toThrow(UnauthorizedException)
  })

  it('rejects a mismatched internal token', () => {
    const guard = new OmsInternalTokenGuard(config({
      OMS_INTERNAL_TOKEN: 'expected-token',
    }))
    expect(() => guard.canActivate(contextWithHeader('wrong-token'))).toThrow(
      UnauthorizedException,
    )
  })

  it('accepts an exact internal token match', () => {
    const guard = new OmsInternalTokenGuard(config({
      OMS_INTERNAL_TOKEN: 'expected-token',
    }))
    expect(guard.canActivate(contextWithHeader('expected-token'))).toBe(true)
  })

  it('supports an environment-configured header name', () => {
    const guard = new OmsInternalTokenGuard(config({
      OMS_INTERNAL_TOKEN: 'expected-token',
      OMS_INTERNAL_TOKEN_HEADER: 'x-private-oms-token',
    }))
    expect(
      guard.canActivate(contextWithHeader('expected-token', 'x-private-oms-token')),
    ).toBe(true)
  })
})
