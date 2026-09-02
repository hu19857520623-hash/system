import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common'
import { Request, Response } from 'express'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'
import { AnhengService } from './anheng.service'
import { clientIpFromRequest } from './wcs-weigh.util'

@Controller('anheng')
export class AnhengController {
  constructor(private readonly service: AnhengService) {}

  @RequirePerms('anheng.view')
  @Get('config')
  config() {
    return this.service.getConfig()
  }

  @RequirePerms('anheng.test')
  @Put('config')
  saveConfig(
    @Body()
    body: {
      enabled?: boolean
      deviceKey?: string | null
      chuteMessage?: string
      requireMemberId?: boolean
      printData?: string | null
    },
  ) {
    return this.service.saveConfig(body)
  }

  @RequirePerms('anheng.view')
  @Get('events')
  events(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.service.listEvents({ page, pageSize, keyword })
  }

  @RequirePerms('anheng.view')
  @Get('photos')
  photos(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.service.listPhotos({ page, pageSize, keyword })
  }

  @RequirePerms('anheng.view')
  @Get('photos/:id/file')
  @Header('Content-Type', 'image/jpeg')
  async photoFile(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const file = await this.service.readPhoto(id)
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  }

  @RequirePerms('anheng.test')
  @Post('simulate/weigh')
  simulateWeigh(@Body() body: unknown, @Req() req: Request) {
    return this.service.handleWeigh(body, {
      body,
      ip: clientIpFromRequest(req),
      source: 'simulate',
    })
  }

  @RequirePerms('anheng.test')
  @Post('simulate/image')
  simulateImage(@Body() body: unknown, @Req() req: Request) {
    return this.service.handleImage(body, {
      body,
      ip: clientIpFromRequest(req),
      source: 'simulate',
    })
  }

  @RequirePerms('anheng.test')
  @Delete('events')
  clear() {
    return this.service.clearTestData()
  }
}
