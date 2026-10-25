import { InventoryModule } from '../inventory/inventory.module'
import { CostModule } from '../cost/cost.module'
import { CustomersModule } from '../customers/customers.module'
import { Module } from '@nestjs/common'
import { AsyncIoService } from './async-io.service'
import { AsyncIoController } from './async-io.controller'
import { AsyncIoExportService } from './async-io-export.service'
import { FileStoreService } from '../../common/file-store.service'
import { LeadsModule } from '../leads/leads.module'
import { ProductsModule } from '../products/products.module'
import { PurchaseModule } from '../purchase/purchase.module'

@Module({
  imports: [LeadsModule, ProductsModule, PurchaseModule, InventoryModule, CostModule, CustomersModule],
  controllers: [AsyncIoController],
  providers: [AsyncIoService, AsyncIoExportService, FileStoreService],
  exports: [AsyncIoService, FileStoreService],
})
export class AsyncIoModule {}
