import { Module } from '@nestjs/common'
import { FileStoreService } from '../../common/file-store.service'
import { AnhengController } from './anheng.controller'
import { AnhengService } from './anheng.service'
import { WcsDeviceController, WcsImageUploadController, WcsWeighingController } from './wcs-device.controller'

@Module({
  controllers: [WcsWeighingController, WcsImageUploadController, WcsDeviceController, AnhengController],
  providers: [AnhengService, FileStoreService],
})
export class AnhengModule {}
