import { Module } from '@nestjs/common'
import { ReturnsController } from './returns.controller'
import { ReturnsService } from './returns.service'
import { OperationLogModule } from '../operation-log/operation-log.module'
import { BillingModule } from '../billing/billing.module'
import { FileStoreService } from '../../common/file-store.service'

import { ReturnsChargeService } from './returns-charge.service'
import { ReturnsSyncService } from './returns-sync.service'

@Module({
  imports: [OperationLogModule, BillingModule],
  controllers: [ReturnsController],
  providers: [ReturnsService, ReturnsChargeService, FileStoreService, ReturnsSyncService],
  exports: [ReturnsSyncService],
})
export class ReturnsModule {}
