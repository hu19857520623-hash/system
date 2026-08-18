import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { AnnouncementService } from './announcement.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { OmsBridge } from '../../common/decorators/oms-bridge.decorator'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'
import { UpsertAnnouncementDto } from './dto/announcement.dto'

@Controller('announcements')
export class AnnouncementController {
  constructor(private readonly service: AnnouncementService) {}

  /** OMS P2：已发布 OMS 渠道公告 */
  @OmsBridge()
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

  @RequirePerms('announcement.manage')
  @Post()
  create(@Body() body: UpsertAnnouncementDto, @CurrentUser('userId') userId: number) {
    return this.service.create(body, userId)
  }

  @RequirePerms('announcement.manage')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpsertAnnouncementDto) {
    return this.service.update(id, body)
  }

  @RequirePerms('announcement.manage')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id)
  }
}
