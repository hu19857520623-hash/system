import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { timingSafeEqual } from 'crypto'
import type { Request } from 'express'

@Injectable()
export class OmsInternalTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = String(this.config.get<string>('OMS_INTERNAL_TOKEN') || '')
    const headerName = String(
      this.config.get<string>('OMS_INTERNAL_TOKEN_HEADER') || 'x-oms-internal-token',
    ).trim().toLowerCase()
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(headerName)) {
      throw new UnauthorizedException('OMS internal authentication failed')
    }
    const supplied = context.switchToHttp().getRequest<Request>().header(headerName) || ''

    if (!expected.trim() || !supplied) {
      throw new UnauthorizedException('OMS internal authentication failed')
    }

    const expectedBytes = Buffer.from(expected)
    const suppliedBytes = Buffer.from(supplied)
    if (
      expectedBytes.length !== suppliedBytes.length ||
      !timingSafeEqual(expectedBytes, suppliedBytes)
    ) {
      throw new UnauthorizedException('OMS internal authentication failed')
    }
    return true
  }
}
