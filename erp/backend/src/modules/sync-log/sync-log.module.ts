import { Module } from '@nestjs/common'
import { SyncLogService } from './sync-log.service'
import { SyncLogController } from './sync-log.controller'
import { AnnouncementModule } from '../announcement/announcement.module'

@Module({
  imports: [AnnouncementModule],
  controllers: [SyncLogController],
  providers: [SyncLogService],
})
export class SyncLogModule {}
