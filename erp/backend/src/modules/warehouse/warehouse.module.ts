import { Module } from '@nestjs/common'
import { WarehouseService } from './warehouse.service'
import { WarehouseController } from './warehouse.controller'
import { TakealotDestService } from './takealot-dest.service'
import { TakealotDestController } from './takealot-dest.controller'

@Module({
  controllers: [WarehouseController, TakealotDestController],
  providers: [WarehouseService, TakealotDestService],
  exports: [TakealotDestService],
})
export class WarehouseModule {}
