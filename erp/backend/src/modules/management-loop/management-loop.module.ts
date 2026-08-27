import { Module } from '@nestjs/common'
import { ManagementLoopController } from './management-loop.controller'
import { ManagementLoopService } from './management-loop.service'

@Module({
  controllers: [ManagementLoopController],
  providers: [ManagementLoopService],
  exports: [ManagementLoopService],
})
export class ManagementLoopModule {}
