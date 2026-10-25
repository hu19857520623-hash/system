import { Body, Controller, Get, Header, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import { AsyncIoService } from './async-io.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'

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
  importFile(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.createImport(body, user)
  }

  @Post()
  create(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.create(body, user)
  }

  @Post(':id/retry')
  retry(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.retryExport(id, body?.expectedAttempt, user)
  }

  @Post(':id/restart')
  restart(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.restartLegacyExport(id, body?.expectedAttempt, user)
  }

  @Get(':id/download')
  @Header('Content-Type', 'text/csv;charset=utf-8')
  async download(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const file = await this.service.download(id, user)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.detail(id, user)
  }
}
