import { Module } from '@nestjs/common'
import { InboundService } from './inbound.service'
import { InboundController } from './inbound.controller'
import { FileStoreService } from '../../common/file-store.service'
import { PricingModule } from '../pricing/pricing.module'

@Module({
  imports: [PricingModule],
  controllers: [InboundController],
  providers: [InboundService, FileStoreService],
})
export class InboundModule {}
