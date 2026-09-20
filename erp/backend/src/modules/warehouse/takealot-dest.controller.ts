import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common'
import { TakealotDestService } from './takealot-dest.service'
import { RequireAnyPerm, RequirePerms } from '../../common/decorators/require-perms.decorator'
import { OmsBridge } from '../../common/decorators/oms-bridge.decorator'

@Controller('takealot-dest-warehouses')
export class TakealotDestController {
  constructor(private readonly service: TakealotDestService) {}

  @RequireAnyPerm(
    'logistics_wh.view',
    'logistics_wh.manage',
    'outbound.view',
    'billing.view',
  )
  @Get()
  list(@Query('includeDisabled') includeDisabled?: string) {
    return this.service.list(includeDisabled === '1' || includeDisabled === 'true')
  }

  @OmsBridge()
  @Get('oms/fulfillment')
  listForOms() {
    return this.service.listForOmsFulfillment()
  }

  @RequirePerms('logistics_wh.manage')
  @Post()
  create(@Body() body: any) {
    return this.service.create(body)
  }

  @RequirePerms('logistics_wh.manage')
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.update(id, body)
  }
}
