import { Module } from '@nestjs/common'
import { LeadsService } from './leads.service'
import { LeadsController } from './leads.controller'
import { FileStoreService } from '../../common/file-store.service'
import { CustomersModule } from '../customers/customers.module'

@Module({
  imports: [CustomersModule],
  controllers: [LeadsController],
  providers: [LeadsService, FileStoreService],
  exports: [LeadsService],
})
export class LeadsModule {}
