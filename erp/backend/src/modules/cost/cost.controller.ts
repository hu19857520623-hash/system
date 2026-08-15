import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { CostService } from './cost.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'

@Controller('cost-ledger')
export class CostController {
  constructor(private readonly service: CostService) {}

  @RequirePerms('cost.view')
  @Get()
  list(@Query() q: PaginationDto & { costType?: string; startDate?: string; endDate?: string; minAmount?: string; maxAmount?: string }) {
    return this.service.list(q)
  }

  @RequirePerms('cost.view')
  @Post()
  create(@Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.create(body, userId)
  }
}
