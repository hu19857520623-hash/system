import { Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common'
import { SyncLogService } from './sync-log.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'

@Controller('sync-logs')
export class SyncLogController {
  constructor(private readonly service: SyncLogService) {}

  @RequirePerms('sync.view')
  @Get()
  list(@Query() q: PaginationDto & { status?: string; syncType?: string }) {
    return this.service.list(q)
  }

  @RequirePerms('sync.retry')
  @Post(':id/retry')
  retry(@Param('id', ParseIntPipe) id: number) {
    return this.service.retry(id)
  }
}
