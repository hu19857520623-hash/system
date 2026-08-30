import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import { LeadsService } from './leads.service'
import { LeadsListQueryDto } from './leads-list.query.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequireAnyPerm, RequirePerms } from '../../common/decorators/require-perms.decorator'
import { CreateCustomerDto } from '../customers/dto/customer.dto'

@Controller('leads')
export class LeadsController {
  constructor(private readonly service: LeadsService) {}

  @RequirePerms('leads_reports.view')
  @Get('report')
  report(@Query('range') range?: string) {
    return this.service.report(range)
  }

  @RequireAnyPerm('leads_pool.view', 'leads_deals.view', 'leads_follow.view')
  @Get()
  list(@Query() q: LeadsListQueryDto) {
    return this.service.list(q)
  }

  @RequirePerms('leads_pool.create')
  @Post('import')
  importCsv(@Body() body: { content: string }, @CurrentUser('userId') userId: number) {
    return this.service.importFromCsv(body.content, userId)
  }

  @RequirePerms('leads_pool.create')
  @Get('assignees')
  assignees(@CurrentUser('userId') userId: number) {
    return this.service.listAssignees(userId)
  }

  @RequireAnyPerm('leads_pool.view', 'leads_follow.view')
  @Get('follow-sales')
  followSales() {
    return this.service.listFollowSales()
  }

  @RequireAnyPerm('leads_deals.view', 'leads_pool.view')
  @Get(':id/deals/:dealId/attachments/:attachmentId')
  async downloadDealAttachment(
    @Param('id', ParseIntPipe) id: number,
    @Param('dealId', ParseIntPipe) dealId: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @Res() res: Response,
  ) {
    const file = await this.service.downloadDealAttachment(id, dealId, attachmentId)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  }

  @RequireAnyPerm('leads_pool.view', 'leads_follow.view', 'leads_deals.view')
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id)
  }

  @RequirePerms('leads_pool.create')
  @Post()
  create(@Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.create(body, userId)
  }

  @RequirePerms('leads_follow.edit')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.update(id, body)
  }

  @RequirePerms('leads_follow.edit')
  @Post(':id/follow-up')
  addFollowUp(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.addFollowUp(id, body, userId)
  }

  @RequirePerms('leads_follow.edit')
  @Post(':id/recall')
  recallToPool(@Param('id', ParseIntPipe) id: number, @CurrentUser('userId') userId: number) {
    return this.service.recallToPool(id, userId)
  }

  @RequirePerms('leads_deals.edit')
  @Post(':id/deal')
  addDeal(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.addDeal(id, body)
  }

  @RequirePerms('leads_deals.edit')
  @Post(':id/to-erp')
  confirmToErp(@Param('id', ParseIntPipe) id: number, @Body() body: CreateCustomerDto) {
    return this.service.confirmToErp(id, body)
  }

  @RequirePerms('leads_deals.edit')
  @Post(':id/deals/:dealId/attachments')
  uploadDealAttachments(
    @Param('id', ParseIntPipe) id: number,
    @Param('dealId', ParseIntPipe) dealId: number,
    @Body() body: { attachments?: { fileName: string; contentBase64?: string }[] },
  ) {
    return this.service.uploadDealAttachments(id, dealId, body?.attachments || [])
  }

  @RequirePerms('leads_pool.create')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id)
  }
}
