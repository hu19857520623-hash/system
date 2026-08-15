import { Module } from '@nestjs/common'
import { AnnouncementService } from './announcement.service'
import { AnnouncementController } from './announcement.controller'

@Module({
  controllers: [AnnouncementController],
  providers: [AnnouncementService],
  exports: [AnnouncementService],
})
export class AnnouncementModule {}
