import { Module } from '@nestjs/common'
import { SyncLogService } from './sync-log.service'
import { SyncLogController } from './sync-log.controller'

@Module({
  controllers: [SyncLogController],
  providers: [SyncLogService],
})
export class SyncLogModule {}
