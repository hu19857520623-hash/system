import { Module } from '@nestjs/common'
import { CostService } from './cost.service'
import { CostController } from './cost.controller'

@Module({
  controllers: [CostController],
  providers: [CostService],
})
export class CostModule {}
