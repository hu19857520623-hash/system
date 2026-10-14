import { Module } from '@nestjs/common'
import { FlowDebugController } from './flow-debug.controller'
import { FlowDebugService } from './flow-debug.service'

@Module({ controllers: [FlowDebugController], providers: [FlowDebugService] })
export class FlowDebugModule {}
