import { Module } from '@nestjs/common'
import { LogisticsReceiptController } from './logistics-receipt.controller'
import { LogisticsReceiptService } from './logistics-receipt.service'

@Module({
  controllers: [LogisticsReceiptController],
  providers: [LogisticsReceiptService],
  exports: [LogisticsReceiptService],
})
export class LogisticsReceiptModule {}
