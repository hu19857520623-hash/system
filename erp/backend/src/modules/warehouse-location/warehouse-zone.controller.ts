import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { WarehouseZoneService } from './warehouse-zone.service'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@Controller('warehouse-zones')
export class WarehouseZoneController {
  constructor(private readonly service: WarehouseZoneService) {}

  @RequirePerms('warehouse_location.view')
  @Get('partition-letters')
  partitionLetters(@Query('warehouseCode') warehouseCode?: string) {
    if (warehouseCode) return this.service.usedPartitionLetters(warehouseCode)
    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  }

  @RequirePerms('warehouse_location.view')
  @Get()
  list(@Query('warehouseCode') warehouseCode?: string) {
    return this.service.list(warehouseCode)
  }

  @RequirePerms('warehouse_location.edit')
  @Post()
  create(@Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.create(body, userId)
  }

  @RequirePerms('warehouse_location.edit')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.update(id, body, userId)
  }
}
