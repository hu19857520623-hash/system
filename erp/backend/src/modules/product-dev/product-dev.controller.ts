import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import { ProductDevService } from './product-dev.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Public } from '../../common/decorators/public.decorator'
import { RequireAnyPerm, RequirePerms } from '../../common/decorators/require-perms.decorator'

@Controller('product-dev')
export class ProductDevController {
  constructor(private readonly service: ProductDevService) {}

  @RequirePerms('product_dev.view')
  @Get()
  list(@Query() q: PaginationDto & { status?: string }) {
    return this.service.list(q)
  }

  @Public()
  @Get('images/:fileName')
  servePriceImage(@Param('fileName') fileName: string, @Res() res: Response) {
    return this.service.servePriceImage(fileName, res)
  }

  @RequirePerms('product_dev.view')
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id)
  }

  @RequirePerms('product_dev.create')
  @Post()
  create(@Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.create(body, userId)
  }

  @RequireAnyPerm('product_dev.create', 'product_dev.edit')
  @Post('price-image')
  uploadPriceImage(@Body() body: { fileName?: string; contentBase64?: string }) {
    return this.service.savePriceImage(body)
  }

  @RequirePerms('product_dev.edit')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.update(id, body, userId)
  }

  @RequirePerms('product_dev.edit')
  @Post(':id/submit')
  submit(@Param('id', ParseIntPipe) id: number, @CurrentUser('userId') userId: number) {
    return this.service.submit(id, userId)
  }

  @RequirePerms('product_audit.approve')
  @Post(':id/approve')
  approve(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.approve(id, userId, body?.remark, body?.purchaseQty)
  }

  @RequirePerms('product_audit.reject')
  @Post(':id/reject')
  reject(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.reject(id, userId, body?.remark)
  }

  @RequirePerms('product_dev.edit')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser('userId') userId: number) {
    return this.service.remove(id, userId)
  }
}
