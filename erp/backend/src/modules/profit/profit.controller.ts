import { Controller, Get, Query } from '@nestjs/common'
import { ProfitService } from './profit.service'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'

@Controller('profit')
export class ProfitController {
  constructor(private readonly service: ProfitService) {}

  @RequirePerms('profit_analysis.view')
  @Get('summary')
  summary(@Query() q: { month?: string }) {
    return this.service.summary(q)
  }

  @RequirePerms('profit_analysis.view')
  @Get('detail')
  detail(@Query() q: { month?: string }) {
    return this.service.detail(q)
  }
}
