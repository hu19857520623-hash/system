import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common'
import { BillingService } from './billing.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { RequirePerms } from '../../common/decorators/require-perms.decorator'
import { Public } from '../../common/decorators/public.decorator'

@Controller('billing')
export class BillingController {
  constructor(private readonly service: BillingService) {}

  /** OMS P2：客户费用明细 */
  @Public()
  @Get('oms/by-customer/:customerCode/charges')
  omsCharges(@Param('customerCode') customerCode: string) {
    return this.service.listChargesForOms(customerCode)
  }

  /** OMS P2：客户账单 */
  @Public()
  @Get('oms/by-customer/:customerCode/bills')
  omsBills(@Param('customerCode') customerCode: string) {
    return this.service.listBillsForOms(customerCode)
  }

  @RequirePerms('billing.view')
  @Get('charges')
  listCharges(@Query() q: PaginationDto & { customerId?: number; chargeType?: string; source?: string; status?: string; dateFrom?: string; dateTo?: string }) {
    return this.service.listCharges(q)
  }

  @RequirePerms('billing.manual')
  @Post('charges')
  createCharge(@Body() body: any) {
    return this.service.createCharge(body)
  }

  @RequirePerms('billing.generate')
  @Post('generate/preview')
  previewGenerate(@Body() body: any) {
    return this.service.previewGenerate(body)
  }

  @RequirePerms('billing.generate')
  @Post('generate')
  generateFromCharges(@Body() body: any) {
    return this.service.generateFromCharges(body)
  }

  @RequirePerms('billing.view')
  @Get()
  list(@Query() q: PaginationDto & { status?: string; customerId?: number }) {
    return this.service.list(q)
  }

  @RequirePerms('billing.view')
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id)
  }

  @RequirePerms('billing.generate')
  @Post()
  create(@Body() body: any) {
    return this.service.generate(body)
  }

  @RequirePerms('billing.generate')
  @Post(':id/confirm')
  confirm(@Param('id', ParseIntPipe) id: number) {
    return this.service.confirm(id)
  }
}
