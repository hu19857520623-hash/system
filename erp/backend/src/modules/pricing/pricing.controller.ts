import { ConflictException, Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { PricingService } from './pricing.service'
import { OmsPurchaseService } from './oms-purchase.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'
import { OmsBridge } from '../../common/decorators/oms-bridge.decorator'
import { OmsPurchaseDto } from './dto/oms-purchase.dto'
import { CatalogVisibilityDto } from './dto/catalog-visibility.dto'

@Controller('pricing')
export class PricingController {
  constructor(
    private readonly service: PricingService,
    private readonly omsPurchase: OmsPurchaseService,
  ) {}

  /** OMS 客户下单回调（幂等：同一 orderNo 重复提交返回原结果） */
  @OmsBridge()
  @Post('oms/purchase')
  omsPurchaseCallback(@Body() body: OmsPurchaseDto) {
    return this.omsPurchase.recordPurchase(body)
  }

  /** OMS 展示层拉取货盘（含剩余库存） */
  @OmsBridge()
  @Get('oms/catalog')
  listOmsCatalog() {
    return this.service.listOmsCatalogForOms()
  }

  @OmsBridge()
  @Get('oms/catalog/:sku')
  getOmsCatalogSku(@Param('sku') sku: string) {
    return this.service.getOmsCatalogSkuForOms(sku)
  }

  @RequirePerms('pricing.view')
  @Get()
  list(@Query() q: PaginationDto & { status?: string }) {
    return this.service.list(q)
  }

  @RequirePerms('pricing.view')
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id)
  }

  @RequirePerms('pricing.set')
  @Post()
  create(@Body() body: any) {
    return this.service.create(body)
  }

  @RequirePerms('pricing.set')
  @Post(':id/visible-stock')
  setVisibleStock(@Param('id', ParseIntPipe) id:number,@Body() body:CatalogVisibilityDto,@CurrentUser('userId') userId:number) {
    return this.service.setVisibleStock(id,body,userId)
  }

  @RequirePerms('pricing.set')
  @Post(':id/freight-callback')
  freightCallback() {
    throw new ConflictException('海运费请在「发运海外仓」对应入库单中填写或补录，系统会自动分摊同步；请返回发运页面继续')
  }

  @RequirePerms('pricing.set')
  @Post(':id/confirm')
  confirm(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @CurrentUser('realName') role: string,
  ) {
    return this.service.confirmPrice(id, body, role)
  }

  @RequirePerms('pricing.sync_oms')
  @Post(':id/sync-oms')
  syncOms(@Param('id', ParseIntPipe) id: number, @CurrentUser('realName') role: string) {
    return this.service.syncOms(id, role)
  }

  @RequirePerms('pricing.sync_oms')
  @Post(':id/share-status')
  setShareStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: unknown,
    @CurrentUser('realName') role: string,
  ) {
    return this.service.setShareStatus(id, status, role)
  }

  @RequirePerms('pricing.set')
  @Post(':id/reprice')
  reprice(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @CurrentUser('realName') role: string,
    @CurrentUser('userId') actor: number,
  ) {
    if(!body?.clientRequestId)throw new ConflictException('页面版本已更新，请刷新后使用原调价核对入口')
    return this.service.reprice(id, body, role, actor)
  }

  @RequirePerms('pricing.set')
  @Get(':id/reprice-requests/:requestId')
  readRepriceRequest(@Param('id',ParseIntPipe) id:number,@Param('requestId') requestId:string,@CurrentUser('userId') actor:number){return this.service.readRepriceRequest(id,requestId,actor)}

  @RequirePerms('pricing.set')
  @Post(':id/reprice-requests/:requestId/cancel')
  cancelRepriceRequest(@Param('id',ParseIntPipe) id:number,@Param('requestId') requestId:string,@CurrentUser('userId') actor:number){return this.service.cancelRepriceRequest(id,requestId,actor)}

  @RequirePerms('pricing.set')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.confirmPrice(id, body, '系统')
  }
}
