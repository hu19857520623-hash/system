import { Module } from '@nestjs/common'
import { ProductDevService } from './product-dev.service'
import { ProductDevController } from './product-dev.controller'
import { PurchaseModule } from '../purchase/purchase.module'
import { FileStoreService } from '../../common/file-store.service'

@Module({
  imports: [PurchaseModule],
  controllers: [ProductDevController],
  providers: [ProductDevService, FileStoreService],
})
export class ProductDevModule {}
