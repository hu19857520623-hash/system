import { Controller, Get, Query } from '@nestjs/common'
import { DashboardService } from './dashboard.service'

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('stats')
  stats() {
    return this.service.stats()
  }

  @Get('trends')
  trends(@Query('days') days?: string) {
    const parsed = Number.parseInt(days ?? '7', 10)
    return this.service.trends(Number.isFinite(parsed) ? parsed : 7)
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
