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

  @RequireAnyPerm('stocktake.view', 'stocktake.count')
  @Get('stocktakes')
  stocktakes(@Query() query: any) { return this.service.listStocktakes(query) }

  @RequirePerms('stocktake.create')
  @Get('stocktake-options')
  stocktakeOptions(@Query('warehouseCode') warehouseCode?: string) {
    return this.service.stocktakeOptions(warehouseCode)
  }

  @RequireAnyPerm('stocktake.view', 'stocktake.count')
  @Get('stocktakes/:id')
  stocktake(@Param('id', ParseIntPipe) id: number) { return this.service.stocktakeDetail(id) }

  @RequireAnyPerm('stocktake.view', 'stocktake.count', 'stocktake.create', 'stocktake.approve')
  @Get('stocktake-requests/:requestId')
  stocktakeRequest(@Param('requestId') requestId: string, @CurrentUser('userId') userId: number) {
    return this.service.stocktakeRequest(requestId, userId)
  }

  @RequirePerms('stocktake.create')
  @Post(['stocktakes', 'stocktake-workflows'])
  createStocktake(@Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.createStocktake(body, userId)
  }

  @RequirePerms('stocktake.count')
  @Post(['stocktakes/:id/count', 'stocktake-workflows/:id/count'])
  count(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.submitCount(id, body, userId)
  }

  @RequirePerms('stocktake.approve')
  @Post(['stocktakes/:id/approve', 'stocktake-workflows/:id/approve'])
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser('userId') userId: number, @Body() body: any) {
    return this.service.approveStocktake(id, userId, body)
  }

  @RequirePerms('stocktake.approve')
  @Post('stocktake-workflows/:id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.transitionStocktake(id, 'cancel', body, userId)
  }

  @RequirePerms('stocktake.create', 'stocktake.approve')
  @Post('stocktake-workflows/:id/replan')
  replan(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.transitionStocktake(id, 'replan', body, userId)
  }

  @RequirePerms('capacity.view')
  @Get('capacity')
  capacity(@Query('warehouseCode') warehouseCode?: string) {
    return this.service.capacityOverview(warehouseCode)
  }

  @RequirePerms('capacity.manage')
  @Post(['capacity/refresh-alerts', 'capacity-workflows/refresh-alerts'])
  refreshAlerts(@Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.refreshCapacityAlerts(body, userId)
  }

  @RequireAnyPerm('capacity.view', 'capacity.manage')
  @Get('capacity-requests/:requestId')
  capacityRequest(@Param('requestId') requestId: string, @CurrentUser('userId') userId: number) {
    return this.service.capacityRequest(requestId, userId)
  }
}
