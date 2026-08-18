import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { PurchaseService } from './purchase.service'
import { PrePurchaseService } from './pre-purchase.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequireAnyPerm, RequirePerms } from '../../common/decorators/require-perms.decorator'
import {
  AssignPurchaserDto,
  CancelPrePurchaseDto,
  CreatePurchaseOrderDto,
  PaymentRemarkDto,
  PoAuditDto,
  PoRejectDto,
  SetActualQtyDto,
  UpdatePrePurchaseDto,
} from './dto/purchase.dto'

@Controller('purchase-orders')
export class PurchaseController {
  constructor(
    private readonly service: PurchaseService,
    private readonly prePurchase: PrePurchaseService,
  ) {}

  @RequirePerms('purchase.view')
  @Get('pre-purchase/pending-assign')
  listPrePoPendingAssign(@Query() q: PaginationDto & { keyword?: string }) {
    return this.prePurchase.listPendingAssign(q)
  }

  @RequirePerms('purchase.view')
  @Get('pre-purchase/my')
  listMyPrePo(@Query() q: PaginationDto & { keyword?: string }, @CurrentUser() user: AuthUser) {
    return this.prePurchase.listMy(q, user)
  }

  @RequirePerms('purchase.view')
  @Get('pre-purchase/:id')
  prePoDetail(@Param('id', ParseIntPipe) id: number) {
    return this.prePurchase.detail(id)
  }

  @RequirePerms('purchase.create')
  @Put('pre-purchase/:id')
  updatePrePo(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdatePrePurchaseDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.prePurchase.update(id, body, user)
  }

  @RequirePerms('purchase.assign')
  @Post('pre-purchase/:id/assign')
  assignPrePo(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AssignPurchaserDto,
    @CurrentUser('userId') userId: number,
  ) {
    return this.prePurchase.assign(id, body.purchaserId, userId)
  }

  @RequirePerms('purchase.create')
  @Post('pre-purchase/:id/cancel')
  cancelPrePo(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CancelPrePurchaseDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.prePurchase.cancel(id, body.reason || '', user)
  }

  @RequirePerms('purchase.create')
  @Post('pre-purchase/:id/confirm')
  confirmPrePo(@Param('id', ParseIntPipe) id: number, @CurrentUser('userId') userId: number) {
    return this.prePurchase.confirm(id, userId)
  }

  @RequireAnyPerm('product_audit.purchase_qty', 'product_audit.approve')
  @Post(':id/set-actual-qty')
  setActualQty(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SetActualQtyDto,
    @CurrentUser('userId') userId: number,
  ) {
    return this.service.setActualQty(id, body, userId)
  }

  @RequirePerms('purchase.view')
  @Get()
  list(@Query() q: PaginationDto & { status?: string }) {
    return this.service.list(q)
  }

  @RequirePerms('purchase.view')
  @Get('pending-skus')
  listPendingSkus(@Query() q: PaginationDto & { keyword?: string }, @CurrentUser() user: AuthUser) {
    return this.service.listPendingSkus(q, user)
  }

  @RequirePerms('purchase.view')
  @Get('pending-master-data')
  listPendingMasterData(@Query() q: PaginationDto & { keyword?: string }, @CurrentUser() user: AuthUser) {
    return this.service.listPendingMasterData(q, user)
  }

  @RequirePerms('purchase.assign')
  @Get('pending-sku-assign')
  listPendingSkuAssign(@Query() q: PaginationDto & { keyword?: string }) {
    return this.service.listPendingSkuAssign(q)
  }

  @RequirePerms('purchase.assign')
  @Post('assign-purchaser/:devId')
  assignPurchaser(
    @Param('devId', ParseIntPipe) devId: number,
    @Body() body: AssignPurchaserDto,
    @CurrentUser('userId') userId: number,
  ) {
    return this.service.assignPurchaser(devId, body.purchaserId, userId)
  }

  @RequirePerms('purchase.view')
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id)
  }

  @RequirePerms('purchase.create')
  @Post()
  create(@Body() body: CreatePurchaseOrderDto, @CurrentUser('userId') userId: number) {
    return this.service.create(body, userId)
  }

  @RequirePerms('purchase.po_audit')
  @Post(':id/approve')
  approve(@Param('id', ParseIntPipe) id: number, @Body() body: PoAuditDto, @CurrentUser('userId') userId: number) {
    return this.service.approve(id, userId, body.remark, body.warehouseCode)
  }

  @RequirePerms('purchase.po_audit')
  @Post(':id/reject-po-audit')
  rejectPoAudit(@Param('id', ParseIntPipe) id: number, @Body() body: PoRejectDto, @CurrentUser('userId') userId: number) {
    return this.service.rejectPoAudit(id, userId, body.remark)
  }

  @RequirePerms('purchase.mark_paid')
  @Post(':id/mark-paid')
  markPaid(@Param('id', ParseIntPipe) id: number, @Body() body: PaymentRemarkDto, @CurrentUser('userId') userId: number) {
    return this.service.setPaymentStatus(id, true, userId, body.remark)
  }

  @RequirePerms('purchase.mark_paid')
  @Post(':id/mark-unpaid')
  markUnpaid(@Param('id', ParseIntPipe) id: number, @Body() body: PaymentRemarkDto, @CurrentUser('userId') userId: number) {
    return this.service.setPaymentStatus(id, false, userId, body.remark)
  }

  @RequirePerms('purchase.create')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser('userId') userId: number) {
    return this.service.remove(id, userId)
  }
}
