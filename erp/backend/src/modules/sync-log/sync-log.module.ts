import { Module } from '@nestjs/common'
import { SyncLogService } from './sync-log.service'
import { SyncLogController } from './sync-log.controller'
import { AnnouncementModule } from '../announcement/announcement.module'
import { ReturnsModule } from '../returns/returns.module'

@Module({
  imports: [AnnouncementModule, ReturnsModule],
  controllers: [SyncLogController],
  providers: [SyncLogService],
})
export class SyncLogModule {}
