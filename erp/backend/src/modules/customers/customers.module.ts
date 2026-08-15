import { Module } from '@nestjs/common'
import { CustomersService } from './customers.service'
import { CustomersController } from './customers.controller'
import { OmsInternalTokenGuard } from './oms-internal-token.guard'
import { CustomerProvisioningService } from './customer-provisioning.service'

@Module({
  controllers: [CustomersController],
  providers: [
    CustomersService,
    CustomerProvisioningService,
    OmsInternalTokenGuard,
  ],
})
export class CustomersModule {}
