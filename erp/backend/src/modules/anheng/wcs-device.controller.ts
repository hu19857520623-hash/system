import { Body, Controller, Headers, Post, Query, Req, Res } from '@nestjs/common'
import { Request, Response } from 'express'
import { Public } from '../../common/decorators/public.decorator'
import { AnhengService } from './anheng.service'
import { clientIpFromRequest } from './wcs-weigh.util'

/** 设备回调：必须返回裸 JSON，不能走 ERP 统一 { code, data } 包装 */
@Public()
@Controller('wcs')
export class WcsDeviceController {
  constructor(private readonly service: AnhengService) {}

  @Post(['weigh', 'weight'])
  async weigh(
    @Body() body: unknown,
    @Query('key') queryKey: string | undefined,
    @Headers('x-device-key') deviceKey: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const reply = await this.service.handleWeigh(body, {
      deviceKey,
      queryKey,
      body,
      ip: clientIpFromRequest(req),
      source: 'device',
    })
    res.status(200).json(reply)
  }

  @Post('image')
  async image(
    @Body() body: unknown,
    @Query('key') queryKey: string | undefined,
    @Headers('x-device-key') deviceKey: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const reply = await this.service.handleImage(body, {
      deviceKey,
      queryKey,
      body,
      ip: clientIpFromRequest(req),
      source: 'device',
    })
    res.status(200).json(reply)
  }
}

/** 对齐 Python WCSWMSClient：POST /api/weighing ，body 为单个 Json 对象 */
@Public()
@Controller('weighing')
export class WcsWeighingController {
  constructor(private readonly service: AnhengService) {}

  @Post()
  async weigh(
    @Body() body: unknown,
    @Query('key') queryKey: string | undefined,
    @Headers('x-device-key') deviceKey: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const reply = await this.service.handleWeigh(body, {
      deviceKey,
      queryKey,
      body,
      ip: clientIpFromRequest(req),
      source: 'device',
    })
    res.status(200).json(reply)
  }
}

/** 文档图片接口；兼容 Python 示例 POST /api/image/upload */
@Public()
@Controller('image')
export class WcsImageUploadController {
  constructor(private readonly service: AnhengService) {}

  @Post('upload')
  async upload(
    @Body() body: unknown,
    @Query('key') queryKey: string | undefined,
    @Headers('x-device-key') deviceKey: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const reply = await this.service.handleImage(body, {
      deviceKey,
      queryKey,
      body,
      ip: clientIpFromRequest(req),
      source: 'device',
    })
    res.status(200).json(reply)
  }
}
