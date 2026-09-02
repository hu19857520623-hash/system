import { Controller, Get, Query } from '@nestjs/common'
import { DashboardService } from './dashboard.service'
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'

@RequirePerms('dashboard.view')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('stats')
  stats(@CurrentUser() user: AuthUser) {
    return this.service.stats(user.userId, user.roleCode)
  }

  @Get('trends')
  trends(@Query('days') days: string | undefined, @CurrentUser() user: AuthUser) {
    const parsed = Number.parseInt(days ?? '7', 10)
    return this.service.trends(Number.isFinite(parsed) ? parsed : 7, user.userId, user.roleCode)
  }

  @Get('announcements')
  announcements() {
    return this.service.announcements()
  }

  @Get('notifications')
  notifications() {
    return this.service.notifications()
  }
}
