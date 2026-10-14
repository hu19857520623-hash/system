import { Controller, Get, Query } from '@nestjs/common'
import { Roles } from '../../common/decorators/roles.decorator'
import { FlowDebugService } from './flow-debug.service'

@Roles('admin')
@Controller('flow-debug')
export class FlowDebugController {
  constructor(private readonly service: FlowDebugService) {}
  @Get('catalog')
  catalog() { return this.service.catalog() }
  @Get('trace')
  trace(@Query() query: { orderNo?: string; customerCode?: string; sku?: string }) { return this.service.trace(query) }
}
