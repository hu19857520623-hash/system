import { Module } from '@nestjs/common'
import { ManagementLoopController } from './management-loop.controller'
import { ManagementLoopService } from './management-loop.service'
import { BillingModule } from '../billing/billing.module'

@Module({
  imports: [BillingModule],
  controllers: [ManagementLoopController],
  providers: [ManagementLoopService],
  exports: [ManagementLoopService],
})
export class ManagementLoopModule {}
