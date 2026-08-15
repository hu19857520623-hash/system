import { Module } from '@nestjs/common'
import { FreightBillService } from './freight-bill.service'
import { FreightBillController } from './freight-bill.controller'

@Module({
  controllers: [FreightBillController],
  providers: [FreightBillService],
  exports: [FreightBillService],
})
export class FreightBillModule {}
