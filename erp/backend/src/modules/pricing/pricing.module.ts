import { Module } from '@nestjs/common'
import { PricingService } from './pricing.service'
import { PricingController } from './pricing.controller'
import { OmsPurchaseService } from './oms-purchase.service'
import { OperationLogModule } from '../operation-log/operation-log.module'
import { BillingModule } from '../billing/billing.module'
import { CosObjectUrlService } from '../../common/cos-object-url.service'

@Module({
  imports: [OperationLogModule, BillingModule],
  controllers: [PricingController],
  providers: [PricingService, OmsPurchaseService, CosObjectUrlService],
  exports: [PricingService, OmsPurchaseService],
})
export class PricingModule {}
