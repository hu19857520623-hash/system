import { Module } from '@nestjs/common'
import { StoreMonitorService } from './store-monitor.service'
import { StoreMonitorController } from './store-monitor.controller'
import { PermissionsModule } from '../../common/permissions/permissions.module'

@Module({
  imports: [PermissionsModule],
  controllers: [StoreMonitorController],
  providers: [StoreMonitorService],
})
export class StoreMonitorModule {}
