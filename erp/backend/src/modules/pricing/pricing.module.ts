import { Module } from '@nestjs/common'
import { PricingService } from './pricing.service'
import { PricingController } from './pricing.controller'
import { OmsPurchaseService } from './oms-purchase.service'
import { OperationLogModule } from '../operation-log/operation-log.module'
import { BillingModule } from '../billing/billing.module'

@Module({
  imports: [OperationLogModule, BillingModule],
  controllers: [PricingController],
  providers: [PricingService, OmsPurchaseService],
  exports: [PricingService, OmsPurchaseService],
})
export class PricingModule {}
