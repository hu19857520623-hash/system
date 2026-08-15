import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { LeadsService } from './leads.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequireAnyPerm, RequirePerms } from '../../common/decorators/require-perms.decorator'

@Controller('leads')
export class LeadsController {
  constructor(private readonly service: LeadsService) {}

  @RequirePerms('leads_reports.view')
  @Get('report')
  report() {
    return this.service.report()
  }

  @RequireAnyPerm('leads_pool.view', 'leads_deals.view')
  @Get()
  list(
    @Query()
    q: PaginationDto & {
      status?: string
      assigneeId?: number
      source?: string
      dealStatus?: string
      shopType?: string
      dealDateFrom?: string
      dealDateTo?: string
      createdAtFrom?: string
      createdAtTo?: string
    },
  ) {
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

  @RequirePerms('leads_pool.view')
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

  @RequirePerms('leads_deals.edit')
  @Post(':id/deal')
  addDeal(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.addDeal(id, body)
  }

  @RequirePerms('leads_pool.create')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id)
  }
}
