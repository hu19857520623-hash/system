import { Module } from '@nestjs/common'
import { ProductDevService } from './product-dev.service'
import { ProductDevController } from './product-dev.controller'
import { PurchaseModule } from '../purchase/purchase.module'

@Module({
  imports: [PurchaseModule],
  controllers: [ProductDevController],
  providers: [ProductDevService],
})
export class ProductDevModule {}
