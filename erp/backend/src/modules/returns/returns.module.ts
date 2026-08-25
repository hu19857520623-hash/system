import { Module } from '@nestjs/common'
import { ReturnsController } from './returns.controller'
import { ReturnsService } from './returns.service'
import { OperationLogModule } from '../operation-log/operation-log.module'
import { BillingModule } from '../billing/billing.module'
import { FileStoreService } from '../../common/file-store.service'

@Module({
  imports: [OperationLogModule, BillingModule],
  controllers: [ReturnsController],
  providers: [ReturnsService, FileStoreService],
})
export class ReturnsModule {}
