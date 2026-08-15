import { Controller, Get, Query } from '@nestjs/common'
import { OperationLogService } from './operation-log.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'

@Controller('operation-logs')
export class OperationLogController {
  constructor(private readonly service: OperationLogService) {}

  @RequirePerms('operation_log.view')
  @Get()
  list(@Query() q: PaginationDto & {
    module?: string
    action?: string
    operatorId?: number
    targetType?: string
    targetId?: string
    dateFrom?: string
    dateTo?: string
  }) {
    return this.service.list(q)
  }
}
