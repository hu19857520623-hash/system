import { All, Body, Controller, Get, Param, ParseIntPipe, Put, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { StoreMonitorService } from './store-monitor.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { AuthUser } from '../../common/decorators/current-user.decorator'
import { RequireAnyPerm, RequirePerms } from '../../common/decorators/require-perms.decorator'

@Controller('store-monitor')
export class StoreMonitorController {
  constructor(private readonly service: StoreMonitorService) {}

  @RequirePerms('store_monitor.view')
  @Get('session')
  session(@CurrentUser() user: AuthUser) {
    return this.service.session(user)
  }

  @RequirePerms('store_monitor.view')
  @Get('stores')
  listStores(@CurrentUser() user: AuthUser) {
    return this.service.listStores(user)
  }

  @RequirePerms('store_monitor.view')
  @Get('stores/:slot/check')
  checkStore(
    @CurrentUser() user: AuthUser,
    @Param('slot', ParseIntPipe) slot: number,
  ) {
    return this.service.checkStore(user, slot)
  }

  @RequireAnyPerm('store_monitor.manage', 'store_monitor.assign')
  @Put('stores/:slot')
  updateStore(
    @CurrentUser() user: AuthUser,
    @Param('slot', ParseIntPipe) slot: number,
    @Body() body: { storeName?: string; apiKey?: string; coachRole?: string; enabled?: boolean; remark?: string },
  ) {
    return this.service.updateStore(user, slot, body)
  }

  @RequirePerms('store_monitor.view')
  @Get('diag')
  diag(@CurrentUser() user: AuthUser, @Res() res: Response) {
    return this.service.proxyDiag(user, res)
  }

  @RequirePerms('store_monitor.manage')
  @All('browser-bootstrap')
  browserBootstrap(@CurrentUser() user: AuthUser, @Res() res: Response) {
    return this.service.proxyBrowserBootstrap(user, res)
  }

  @RequirePerms('store_monitor.view')
  @All('proxy/*')
  proxy(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const slot = Number(req.headers['x-store-slot'])
    if (!Number.isInteger(slot)) {
      return res.status(400).json({ message: '缺少或无效的 X-Store-Slot 请求头' })
    }
    return this.service.proxyTakealot(user, slot, req, res)
  }
}
