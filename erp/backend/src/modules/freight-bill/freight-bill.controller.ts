import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { FreightBillService } from './freight-bill.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'

@Controller('freight-bills')
export class FreightBillController {
  constructor(private readonly service: FreightBillService) {}

  @RequirePerms('receivable_payable.view')
  @Get()
  list(@Query() q: PaginationDto & { status?: string }) {
    return this.service.list(q)
  }

  @RequirePerms('receivable_payable.manual')
  @Post()
  create(@Body() body: any) {
    return this.service.create(body)
  }
}
