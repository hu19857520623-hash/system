import { Body, Controller, Get, Header, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common'
import { Response } from 'express'
import { WarehouseLocationService } from './warehouse-location.service'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@Controller('locations')
export class WarehouseLocationController {
  constructor(private readonly service: WarehouseLocationService) {}

  @RequirePerms('warehouse_location.view')
  @Get('labels/print')
  @Header('Content-Type', 'text/html;charset=utf-8')
  async printLabels(
    @Res() res: Response,
    @Query('ids') ids?: string,
    @Query('warehouseCode') warehouseCode?: string,
    @Query('zoneId') zoneId?: string,
  ) {
    const idList = ids ? ids.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)) : undefined
    const file = await this.service.getLabels({
      ids: idList,
      warehouseCode,
      zoneId: zoneId ? Number(zoneId) : undefined,
    })
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  }

  @RequirePerms('warehouse_location.view')
  @Get()
  list(
    @Query('warehouseCode') warehouseCode?: string,
    @Query('zoneId') zoneId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.list({
      warehouseCode,
      zoneId: zoneId ? Number(zoneId) : undefined,
      status,
    })
  }

  @RequirePerms('warehouse_location.view')
  @Get(':id/label')
  @Header('Content-Type', 'text/html;charset=utf-8')
  async label(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const file = await this.service.getLabel(id)
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  }

  @RequirePerms('warehouse_location.view')
  @Get(':id/inventory')
  inventory(@Param('id', ParseIntPipe) id: number) {
    return this.service.locationInventory(id)
  }

  @RequirePerms('warehouse_location.edit')
  @Post()
  create(@Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.create(body, userId)
  }

  @RequirePerms('warehouse_location.batch_create')
  @Post('batch')
  batchCreate(@Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.batchCreate(body, userId)
  }

  @RequirePerms('warehouse_location.edit')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.update(id, body, userId)
  }
}
