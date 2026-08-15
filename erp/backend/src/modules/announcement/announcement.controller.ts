import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { AnnouncementService } from './announcement.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Public } from '../../common/decorators/public.decorator'

@Controller('announcements')
export class AnnouncementController {
  constructor(private readonly service: AnnouncementService) {}

  /** OMS P2：已发布 OMS 渠道公告 */
  @Public()
  @Get('oms')
  listForOms() {
    return this.service.listForOms()
  }

  @Get()
  list(@Query() q: PaginationDto & { status?: string }) {
    return this.service.list(q)
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id)
  }

  @Post()
  create(@Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.create(body, userId)
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.update(id, body)
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id)
  }
}
