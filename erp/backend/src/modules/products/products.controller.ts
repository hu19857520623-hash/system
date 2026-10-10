import { Body, Controller, Delete, Get, GoneException, Header, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import { ProductsService } from './products.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { RequireAnyPerm, RequirePerms } from '../../common/decorators/require-perms.decorator'
import { Public } from '../../common/decorators/public.decorator'
import { OmsBridge } from '../../common/decorators/oms-bridge.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@Controller('products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @RequirePerms('products.view')
  @Get()
  list(@Query() q: PaginationDto & { status?: string }) {
    return this.service.list(q)
  }

  @RequireAnyPerm('products.view', 'product_audit.label')
  @Get('by-sku/:sku/label')
  @Header('Content-Type', 'text/html;charset=utf-8')
  async skuLabel(@Param('sku') sku: string, @Res() res: Response) {
    const file = await this.service.getSkuLabel(sku)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  }

  @Public()
  @Get('images/:fileName')
  serveImage(@Param('fileName') fileName: string, @Res() res: Response) {
    return this.service.serveImage(fileName, res)
  }

  /** 历史 OMS 写入入口已停用；客户商品只保存在 OMS 并经 SKU 查询读取。 */
  @OmsBridge()
  @Post('oms')
  createFromOms() {
    throw new GoneException('OMS 商品仅保存在 OMS，请刷新 OMS 页面后重试')
  }

  /** OMS 商品资料及生命周期操作。 */
  @OmsBridge()
  @Put('oms/:sku')
  updateFromOms() {
    throw new GoneException('OMS 商品仅保存在 OMS，请刷新 OMS 页面后重试')
  }

  @OmsBridge()
  @Post('oms/:sku/disable')
  disableFromOms() {
    throw new GoneException('OMS 商品仅保存在 OMS，请刷新 OMS 页面后重试')
  }

  @OmsBridge()
  @Post('oms/:sku/enable')
  enableFromOms() {
    throw new GoneException('OMS 商品仅保存在 OMS，请刷新 OMS 页面后重试')
  }

  @OmsBridge()
  @Delete('oms/:sku')
  removeFromOms() {
    throw new GoneException('OMS 商品仅保存在 OMS，请刷新 OMS 页面后重试')
  }

  @RequirePerms('products.view')
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id)
  }

  @RequirePerms('products.edit')
  @Post()
  create(@Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.create(body, userId)
  }

  @RequirePerms('products.edit')
  @Post('import')
  importCsv(@Body() body: { content: string }, @CurrentUser('userId') userId: number) {
    return this.service.importFromCsv(body.content, userId)
  }

  @RequirePerms('products.edit')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.update(id, body, userId)
  }

  @RequirePerms('products.edit')
  @Post(':id/image')
  uploadImage(@Param('id', ParseIntPipe) id: number, @Body() body: { fileName: string; contentBase64: string }) {
    return this.service.uploadImage(id, body)
  }

  @RequirePerms('products.edit')
  @Delete(':id/images/:imageId')
  deleteImage(@Param('id', ParseIntPipe) id: number, @Param('imageId', ParseIntPipe) imageId: number) {
    return this.service.deleteImage(id, imageId)
  }

  @RequirePerms('products.edit')
  @Post(':id/disable')
  disable(@Param('id', ParseIntPipe) id: number, @CurrentUser('userId') userId: number) {
    return this.service.disable(id, userId)
  }

  @RequirePerms('products.edit')
  @Post(':id/enable')
  enable(@Param('id', ParseIntPipe) id: number, @CurrentUser('userId') userId: number) {
    return this.service.enable(id, userId)
  }

  @RequirePerms('products.edit')
  @Post(':id/confirm-master')
  confirmMaster(@Param('id', ParseIntPipe) id: number, @CurrentUser('userId') userId: number) {
    return this.service.confirmMaster(id, userId)
  }

  @RequirePerms('products.edit')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id)
  }
}
