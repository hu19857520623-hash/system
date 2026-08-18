import { Body, Controller, Get, Post, Put, Req } from '@nestjs/common'
import type { Request } from 'express'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { ChangePasswordDto } from './dto/change-password.dto'
import { Public } from '../../common/decorators/public.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('health')
  health() {
    return { ok: true, service: 'erp-api' }
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    const clientKey = String(req.ip || req.socket?.remoteAddress || 'unknown')
    return this.authService.login(dto, clientKey)
  }

  @Get('profile')
  profile(@CurrentUser('userId') userId: number) {
    return this.authService.profile(userId)
  }

  @Put('profile')
  updateProfile(@CurrentUser('userId') userId: number, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(userId, dto)
  }

  @Put('password')
  changePassword(@CurrentUser('userId') userId: number, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(userId, dto)
  }
}
