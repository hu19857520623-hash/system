import { Global, Module } from '@nestjs/common'
import { PermissionsCatalogController } from './permissions-catalog.controller'
import { PermissionsService } from './permissions.service'

@Global()
@Module({
  controllers: [PermissionsCatalogController],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
