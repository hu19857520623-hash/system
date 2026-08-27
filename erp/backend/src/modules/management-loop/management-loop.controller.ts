import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequireAnyPerm, RequirePerms } from '../../common/decorators/require-perms.decorator'
import { ManagementLoopService } from './management-loop.service'

@Controller('management-loop')
export class ManagementLoopController {
  constructor(private readonly service: ManagementLoopService) {}

  @RequireAnyPerm('reports.view', 'wms_reports.view')
  @Get('reports/summary')
  reportSummary(@Query() query: any) { return this.service.reportSummary(query) }

  @RequireAnyPerm('reports.view', 'wms_reports.view')
  @Get('reports/inbound')
  inboundReport(@Query() query: any) { return this.service.inboundReport(query) }

  @RequireAnyPerm('reports.view', 'wms_reports.view')
  @Get('reports/outbound')
  outboundReport(@Query() query: any) { return this.service.outboundReport(query) }

  @RequirePerms('stocktake.view')
  @Get('stocktakes')
  stocktakes(@Query() query: any) { return this.service.listStocktakes(query) }

  @RequirePerms('stocktake.view')
  @Get('stocktakes/:id')
  stocktake(@Param('id', ParseIntPipe) id: number) { return this.service.stocktakeDetail(id) }

  @RequirePerms('stocktake.create')
  @Post('stocktakes')
  createStocktake(@Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.createStocktake(body, userId)
  }

  @RequirePerms('stocktake.count')
  @Post('stocktakes/:id/count')
  count(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.submitCount(id, body, userId)
  }

  @RequirePerms('stocktake.approve')
  @Post('stocktakes/:id/approve')
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser('userId') userId: number) {
    return this.service.approveStocktake(id, userId)
  }

  @RequirePerms('capacity.view')
  @Get('capacity')
  capacity(@Query('warehouseCode') warehouseCode?: string) {
    return this.service.capacityOverview(warehouseCode)
  }

  @RequirePerms('capacity.manage')
  @Post('capacity/refresh-alerts')
  refreshAlerts(@Body() body: { warehouseCode?: string }) {
    return this.service.refreshCapacityAlerts(body?.warehouseCode)
  }
}
