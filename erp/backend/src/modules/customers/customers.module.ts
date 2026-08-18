import { Module } from '@nestjs/common'
import { CustomersService } from './customers.service'
import { CustomersController } from './customers.controller'
import { CustomerProvisioningService } from './customer-provisioning.service'

@Module({
  controllers: [CustomersController],
  providers: [
    CustomersService,
    CustomerProvisioningService,
  ],
  exports: [CustomersService],
})
export class CustomersModule {}
