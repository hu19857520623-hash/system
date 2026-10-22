import { Body, Controller, Get, Header, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import { AsyncIoService } from './async-io.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequireAnyPerm, RequirePerms } from '../../common/decorators/require-perms.decorator'

@Controller('async-io')
export class AsyncIoController {
  constructor(private readonly service: AsyncIoService) {}

  @Get()
  list(@Query() q: PaginationDto & { jobType?: string }, @CurrentUser() user: AuthUser) {
    return this.service.list(q, user)
  }

  @Post('export')
  export(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.createExport(body, user)
  }

  @RequirePerms('async_io.import')
  @Post('import')
  importFile(@Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.createImport(body, userId)
  }

  @Post()
  create(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.create(body, user)
  }

  @Get(':id/download')
  @Header('Content-Type', 'text/csv;charset=utf-8')
  async download(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const file = await this.service.download(id, user)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  }

  @RequireAnyPerm('async_io.import', 'async_io.export', 'leads_pool.export', 'leads_deals.export', 'leads_reports.export', 'products.export', 'sku_query.export', 'purchase.export', 'logistics_wh.export', 'return.export', 'outbound.export', 'inventory_query.export', 'wms_reports.export', 'cost.export', 'operating_ledger.export', 'billing.export', 'receivable_payable.export', 'budget_credit.export', 'sync.export', 'flow_debug.export')
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id)
  }
}
