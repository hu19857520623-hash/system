import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { LogisticsReceiptService } from './logistics-receipt.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'

@Controller('logistics-receipts')
export class LogisticsReceiptController {
  constructor(private readonly service: LogisticsReceiptService) {}

  @RequirePerms('logistics_wh.receive')
  @Get('pending-pos')
  listPending(@Query('warehouseCode') warehouseCode?: string) {
    return this.service.listPendingPos(warehouseCode)
  }

  @RequirePerms('logistics_wh.view')
  @Get()
  list(@Query() q: PaginationDto & { warehouseCode?: string }) {
    return this.service.list(q)
  }

  @RequirePerms('logistics_wh.receive')
  @Post()
  create(@Body() body: any, @CurrentUser('realName') realName: string, @CurrentUser('userId') userId: number) {
    return this.service.create(body, realName, userId)
  }
}
