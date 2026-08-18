import { Module } from '@nestjs/common'
import { MingruiController } from './mingrui.controller'
import { MingruiService } from './mingrui.service'

@Module({
  controllers: [MingruiController],
  providers: [MingruiService],
  exports: [MingruiService],
})
export class MingruiModule {}
