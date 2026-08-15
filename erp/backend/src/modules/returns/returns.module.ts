import { Module } from '@nestjs/common'
import { ReturnsController } from './returns.controller'
import { ReturnsService } from './returns.service'
import { OperationLogModule } from '../operation-log/operation-log.module'
import { FileStoreService } from '../../common/file-store.service'

@Module({
  imports: [OperationLogModule],
  controllers: [ReturnsController],
  providers: [ReturnsService, FileStoreService],
})
export class ReturnsModule {}
