import { Module } from '@nestjs/common'
import { ProductsService } from './products.service'
import { ProductsController } from './products.controller'
import { FileStoreService } from '../../common/file-store.service'
import { CosObjectUrlService } from '../../common/cos-object-url.service'
import { OperationLogModule } from '../operation-log/operation-log.module'

@Module({
  imports: [OperationLogModule],
  controllers: [ProductsController],
  providers: [ProductsService, FileStoreService, CosObjectUrlService],
  exports: [ProductsService],
})
export class ProductsModule {}
