import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'
import { CreateMingruiShipmentDto, MingruiListQueryDto, SyncMingruiQueryDto, UpdateMingruiShipmentDto } from './mingrui.dto'
import { MingruiService } from './mingrui.service'

@Controller('mingrui-shipments')
export class MingruiController {
  constructor(private readonly service: MingruiService) {}

  @RequirePerms('mingrui.view')
  @Get()
  list(@Query() q: MingruiListQueryDto) {
    return this.service.list(q)
  }

  @RequirePerms('mingrui.view')
  @Get('eligible-pos')
  eligiblePos() {
    return this.service.eligiblePos()
  }

  @RequirePerms('mingrui.view')
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id)
  }

  @RequirePerms('mingrui.order')
  @Post()
  create(@Body() body: CreateMingruiShipmentDto, @CurrentUser('userId') userId: number) {
    return this.service.create(body, userId)
  }

  @RequirePerms('mingrui.order')
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateMingruiShipmentDto) {
    return this.service.update(id, body)
  }

  @RequirePerms('mingrui.order')
  @Post(':id/submit')
  submit(@Param('id', ParseIntPipe) id: number) {
    return this.service.submit(id)
  }

  @RequirePerms('mingrui.view')
  @Post(':id/sync')
  sync(@Param('id', ParseIntPipe) id: number, @Body() body: SyncMingruiQueryDto = {}) {
    return this.service.sync(id, body)
  }

  @RequirePerms('mingrui.order')
  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.service.cancel(id)
  }
}
