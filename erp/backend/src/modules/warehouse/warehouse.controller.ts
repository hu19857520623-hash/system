import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common'
import { WarehouseService } from './warehouse.service'
import { RequireAnyPerm, RequirePerms } from '../../common/decorators/require-perms.decorator'

@Controller('warehouses')
export class WarehouseController {
  constructor(private readonly service: WarehouseService) {}

  @RequireAnyPerm(
    'logistics_wh.view',
    'outbound.view',
    'outbound.create',
    'outbound.pick',
    'inventory_query.view',
    'create_inbound.view',
    'inbound.view',
    'inbound.arrival_scan',
    'mingrui.view',
    'capacity.view',
    'capacity.manage',
  )
  @Get()
  list(@Query('type') type?: string) {
    return this.service.list(type)
  }

  @RequireAnyPerm('logistics_wh.view', 'outbound.view', 'inventory_query.view')
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id)
  }

  @RequirePerms('logistics_wh.manage')
  @Post()
  create(@Body() body: any) {
    return this.service.create(body)
  }

  @RequireAnyPerm('logistics_wh.manage', 'capacity.manage')
  @Patch(':id/capacity')
  updateCapacity(@Param('id', ParseIntPipe) id: number, @Body() body: { totalVolumeCbm?: number | null }) {
    return this.service.updateCapacity(id, body?.totalVolumeCbm)
  }

  @RequirePerms('logistics_wh.manage')
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.update(id, body)
  }
}
