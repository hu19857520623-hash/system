import { Module } from '@nestjs/common'
import { DashboardService } from './dashboard.service'
import { DashboardController } from './dashboard.controller'
import { AnnouncementModule } from '../announcement/announcement.module'
import { PermissionsModule } from '../../common/permissions/permissions.module'

@Module({
  imports: [AnnouncementModule, PermissionsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
