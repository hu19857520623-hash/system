import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'
import { CreateOperatingLedgerDto, UpdateOperatingLedgerDto } from './dto/operating-ledger.dto'
import { OperatingLedgerService, type OperatingLedgerQuery } from './operating-ledger.service'

@Controller('operating-ledger')
export class OperatingLedgerController {
  constructor(private readonly service: OperatingLedgerService) {}

  @RequirePerms('operating_ledger.view')
  @Get()
  list(@Query() query: OperatingLedgerQuery) {
    return this.service.list(query)
  }

  @RequirePerms('operating_ledger.manage')
  @Post()
  create(@Body() body: CreateOperatingLedgerDto, @CurrentUser('userId') userId: number) {
    return this.service.create(body, userId)
  }

  @RequirePerms('operating_ledger.manage')
  @Post('import')
  importCsv(
    @Body() body: { content?: string; fileName?: string },
    @CurrentUser('userId') userId: number,
  ) {
    return this.service.importCsv(String(body.content || ''), userId)
  }

  @RequirePerms('operating_ledger.manage')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateOperatingLedgerDto) {
    return this.service.update(id, body)
  }

  @RequirePerms('operating_ledger.manage')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id)
  }
}
