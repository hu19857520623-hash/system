import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'
import { UpsertInboundFeeRuleDto } from './dto/inbound-fee.dto'
import { InboundFeeService } from './inbound-fee.service'

@Controller('inbound-fee-rules')
export class InboundFeeController {
  constructor(private readonly service: InboundFeeService) {}

  @RequirePerms('inbound_fee.view')
  @Get()
  list() {
    return this.service.listRules()
  }

  @RequirePerms('inbound_fee.view')
  @Get('options')
  options() {
    return this.service.options()
  }

  @RequirePerms('inbound_fee.manage')
  @Post()
  create(@Body() body: UpsertInboundFeeRuleDto, @CurrentUser('userId') userId: number) {
    return this.service.createRule(body, userId)
  }

  @RequirePerms('inbound_fee.manage')
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpsertInboundFeeRuleDto) {
    return this.service.updateRule(id, body)
  }
}
