import { Module } from '@nestjs/common'
import { PricingService } from './pricing.service'
import { PricingController } from './pricing.controller'
import { OmsPurchaseService } from './oms-purchase.service'
import { OperationLogModule } from '../operation-log/operation-log.module'

@Module({
  imports: [OperationLogModule],
  controllers: [PricingController],
  providers: [PricingService, OmsPurchaseService],
  exports: [PricingService, OmsPurchaseService],
})
export class PricingModule {}
