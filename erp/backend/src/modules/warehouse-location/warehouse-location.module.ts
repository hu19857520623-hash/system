import { Module } from '@nestjs/common'
import { WarehouseZoneController } from './warehouse-zone.controller'
import { WarehouseZoneService } from './warehouse-zone.service'
import { WarehouseLocationController } from './warehouse-location.controller'
import { WarehouseLocationService } from './warehouse-location.service'

@Module({
  controllers: [WarehouseZoneController, WarehouseLocationController],
  providers: [WarehouseZoneService, WarehouseLocationService],
  exports: [WarehouseZoneService, WarehouseLocationService],
})
export class WarehouseLocationModule {}
