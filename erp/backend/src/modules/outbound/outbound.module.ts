import { Module } from '@nestjs/common'
import { BillingModule } from '../billing/billing.module'
import { FileStoreService } from '../../common/file-store.service'
import { OutboundController } from './outbound.controller'
import { OutboundService } from './outbound.service'
import { OutboundBillingService } from './outbound-billing.service'

@Module({
  imports: [BillingModule],
  controllers: [OutboundController],
  providers: [OutboundService, OutboundBillingService, FileStoreService],
})
export class OutboundModule {}
