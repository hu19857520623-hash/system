import { Body, Controller, Get, Header, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import { AsyncIoService } from './async-io.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequireAnyPerm, RequirePerms } from '../../common/decorators/require-perms.decorator'

@Controller('async-io')
export class AsyncIoController {
  constructor(private readonly service: AsyncIoService) {}

  @RequireAnyPerm('async_io.import', 'async_io.export')
  @Get()
  list(@Query() q: PaginationDto & { jobType?: string }) {
    return this.service.list(q)
  }

  @RequirePerms('async_io.export')
  @Post('export')
  export(@Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.createExport(body, userId)
  }

  @RequirePerms('async_io.import')
  @Post('import')
  importFile(@Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.createImport(body, userId)
  }

  @RequireAnyPerm('async_io.import', 'async_io.export')
  @Post()
  create(@Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.create(body, userId)
  }

  @RequireAnyPerm('async_io.import', 'async_io.export')
  @Get(':id/download')
  @Header('Content-Type', 'text/csv;charset=utf-8')
  async download(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const file = await this.service.download(id)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  }

  @RequireAnyPerm('async_io.import', 'async_io.export')
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id)
  }
}
