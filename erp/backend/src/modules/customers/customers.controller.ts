import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { CustomersService } from './customers.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequireAnyPerm, RequirePerms } from '../../common/decorators/require-perms.decorator'
import { OmsBridge } from '../../common/decorators/oms-bridge.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import {
  CreateCustomerDto,
  InternalSetPortalTemporaryPasswordDto,
  RechargeCustomerDto,
  SetPortalTemporaryPasswordDto,
  UpdateCustomerDto,
} from './dto/customer.dto'

@Controller('customers')
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @RequireAnyPerm('budget_credit.view', 'billing.view', 'outbound.view')
  @Get()
  list(@Query() q: PaginationDto & Record<string, string>) {
    return this.service.list(q)
  }

  /** OMS server：使用共享数据库执行与 ERP 开户相同的原子开通流程 */
  @OmsBridge()
  @Post('oms/provision')
  provisionFromOms(@Body() body: CreateCustomerDto) {
    return this.service.provisionFromOms(body)
  }

  /** 生产部署：读取容器内 customers-import.json，为已有 ERP 客户开通 OMS */
  @OmsBridge()
  @Post('oms/import-legacy')
  importLegacyFromFile() {
    return this.service.importLegacyFromFile()
  }

  /** OMS server：由内部调用方重置临时密码，且强制首次登录改密。 */
  @OmsBridge()
  @Post('oms/reset-temporary-password')
  setPortalTemporaryPasswordFromOms(
    @Body() body: InternalSetPortalTemporaryPasswordDto,
  ) {
    return this.service.setPortalTemporaryPasswordFromOms(body.customerCode, body)
  }

  /** OMS：按客户编码查主数据与余额 */
  @OmsBridge()
  @Get('oms/by-code/:customerCode')
  omsCustomerByCode(@Param('customerCode') customerCode: string) {
    return this.service.findByCodeForOms(customerCode)
  }

  /** OMS：按客户编码查货盘持有库存 */
  @OmsBridge()
  @Get('oms/by-code/:customerCode/sku-inventory')
  omsSkuInventoryByCode(@Param('customerCode') customerCode: string) {
    return this.service.skuInventoryByCodeForOms(customerCode)
  }

  /** OMS P1：客户库存视图（持有 + 仓存） */
  @OmsBridge()
  @Get('oms/by-code/:customerCode/inventory-view')
  omsInventoryView(
    @Param('customerCode') customerCode: string,
    @Query('warehouseCode') warehouseCode?: string,
  ) {
    return this.service.inventoryViewForOms(customerCode, warehouseCode || 'WMS-JHB-01')
  }

  /** OMS P2：客户自助充值 */
  @OmsBridge()
  @Post('oms/by-code/:customerCode/recharge')
  omsRecharge(@Param('customerCode') customerCode: string, @Body() body: RechargeCustomerDto) {
    return this.service.rechargeFromOms(customerCode, body)
  }

  /** OMS P2：充值记录 */
  @OmsBridge()
  @Get('oms/by-code/:customerCode/recharges')
  omsRecharges(@Param('customerCode') customerCode: string) {
    return this.service.listRechargesForOms(customerCode)
  }

  @RequireAnyPerm('budget_credit.view', 'billing.view', 'outbound.view')
  @Get(':id/sku-inventory')
  skuInventory(@Param('id', ParseIntPipe) id: number) {
    return this.service.skuInventory(id)
  }

  @RequireAnyPerm('budget_credit.view', 'billing.view', 'outbound.view')
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id)
  }

  @RequirePerms('budget_credit.view')
  @Get(':id/recharges')
  history(@Param('id', ParseIntPipe) id: number) {
    return this.service.rechargeHistory(id)
  }

  @RequirePerms('budget_credit.create')
  @Post()
  create(@Body() body: CreateCustomerDto) {
    return this.service.create(body)
  }

  @RequirePerms('budget_credit.create')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateCustomerDto) {
    return this.service.update(id, body)
  }

  @RequirePerms('budget_credit.create')
  @Roles('admin')
  @Post(':id/portal-password')
  setPortalTemporaryPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SetPortalTemporaryPasswordDto,
  ) {
    return this.service.setPortalTemporaryPassword(id, body)
  }

  @RequirePerms('budget_credit.create')
  @Post(':id/recharge')
  recharge(@Param('id', ParseIntPipe) id: number, @Body() body: RechargeCustomerDto, @CurrentUser('userId') userId: number) {
    return this.service.recharge(id, body, userId)
  }
}
