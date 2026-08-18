import { Controller, Get, Query } from '@nestjs/common'
import { ProfitQuery, ProfitService } from './profit.service'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'

@Controller('profit')
export class ProfitController {
  constructor(private readonly service: ProfitService) {}

  @RequirePerms('profit_analysis.view')
  @Get('summary')
  summary(@Query() q: ProfitQuery) {
    return this.service.summary(q)
  }

  @RequirePerms('profit_analysis.view')
  @Get('detail')
  detail(@Query() q: ProfitQuery & { dim?: string }) {
    return this.service.detail(q)
  }
}
