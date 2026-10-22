import { Module } from '@nestjs/common'
import { PurchaseService } from './purchase.service'
import { PrePurchaseService } from './pre-purchase.service'
import { PurchaseController } from './purchase.controller'

@Module({
  imports: [],
  controllers: [PurchaseController],
  providers: [PurchaseService, PrePurchaseService],
  exports: [PurchaseService, PrePurchaseService],
})
export class PurchaseModule {}
