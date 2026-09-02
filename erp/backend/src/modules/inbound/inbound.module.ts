import { Module } from '@nestjs/common'
import { FileStoreService } from '../../common/file-store.service'
import { BillingModule } from '../billing/billing.module'
import { PricingModule } from '../pricing/pricing.module'
import { InboundController } from './inbound.controller'
import { InboundFeeController } from './inbound-fee.controller'
import { InboundFeeService } from './inbound-fee.service'
import { InboundService } from './inbound.service'

@Module({
  imports: [PricingModule, BillingModule],
  controllers: [InboundController, InboundFeeController],
  providers: [InboundService, InboundFeeService, FileStoreService],
})
export class InboundModule {}
