import { Body, Controller, Delete, Get, Header, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import { InboundService } from './inbound.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequireAnyPerm, RequirePerms } from '../../common/decorators/require-perms.decorator'
import { OmsBridge } from '../../common/decorators/oms-bridge.decorator'
import { CreateOmsAsnDto } from './dto/oms-asn.dto'

@Controller('inbound')
export class InboundController {
  constructor(private readonly service: InboundService) {}

  /** OMS P1：客户预约入库 ASN */
  @OmsBridge()
  @Post('oms/asn')
  omsCreateAsn(@Body() body: CreateOmsAsnDto) {
    return this.service.createAsnFromOms(body)
  }

  @OmsBridge()
  @Get('oms/by-customer/:customerCode')
  omsListByCustomer(@Param('customerCode') customerCode: string) {
    return this.service.listByOmsCustomer(customerCode)
  }

  @OmsBridge()
  @Get('oms/by-no/:inboundNo')
  omsGetByNo(@Param('inboundNo') inboundNo: string) {
    return this.service.getByInboundNoForOms(inboundNo)
  }

  @OmsBridge()
  @Get('oms/by-no/:inboundNo/attachment/:attachmentId')
  @Header('Content-Type', 'application/octet-stream')
  async omsDownloadAttachment(
    @Param('inboundNo') inboundNo: string,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @Query('customerCode') customerCode: string,
    @Res() res: Response,
  ) {
    const file = await this.service.downloadOmsAttachment(inboundNo, attachmentId, customerCode)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  }

  @RequirePerms('create_inbound.view')
  @Get('drafts')
  listDrafts(@CurrentUser('userId') userId: number) {
    return this.service.listDrafts(userId)
  }

  @RequirePerms('create_inbound.create')
  @Post('drafts')
  saveDraft(@Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.saveDraft(body.draftNo || body.id, body.form || body._form || body, userId)
  }

  @RequirePerms('create_inbound.create')
  @Delete('drafts/:draftNo')
  deleteDraft(@Param('draftNo') draftNo: string) {
    return this.service.deleteDraft(draftNo)
  }

  @RequirePerms('create_inbound.create')
  @Post('attachments')
  uploadAttachment(@Body() body: any) {
    return this.service.uploadAttachment(body)
  }

  @RequireAnyPerm(
    'create_inbound.view',
    'inbound.view',
    'inbound.arrival_scan',
    'inbound.receive',
    'inbound.qc',
    'inbound.putaway',
  )
  @Get()
  list(@Query() q: PaginationDto & { status?: string }) {
    return this.service.list(q)
  }

  @RequireAnyPerm('inbound.arrival_scan', 'inbound.view')
  @Get('arrival-scans')
  listArrivalScans(@Query() q: { warehouseCode?: string; limit?: string }) {
    return this.service.listArrivalScans({
      warehouseCode: q.warehouseCode,
      limit: q.limit ? Number(q.limit) : undefined,
    })
  }

  @RequirePerms('inbound.arrival_scan')
  @Post('arrival-scan')
  arrivalScan(@Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.arrivalScan(body, userId)
  }

  @RequirePerms('create_inbound.label')
  @Get(':id/labels/sku')
  @Header('Content-Type', 'text/html;charset=utf-8')
  async skuLabel(@Param('id', ParseIntPipe) id: number, @Query('sku') sku: string, @Res() res: Response) {
    const file = await this.service.getSkuLabel(id, sku)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  }

  @RequirePerms('create_inbound.label')
  @Get(':id/labels/outer')
  @Header('Content-Type', 'text/html;charset=utf-8')
  async outerLabel(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const file = await this.service.getOuterLabel(id)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  }

  @RequireAnyPerm('create_inbound.view', 'inbound.view')
  @Get(':id/attachments/:attachmentId')
  @Header('Content-Type', 'application/octet-stream')
  async downloadStaffAttachment(
    @Param('id', ParseIntPipe) id: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @Res() res: Response,
  ) {
    const file = await this.service.downloadStaffAttachment(id, attachmentId)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  }

  @RequireAnyPerm(
    'create_inbound.view',
    'inbound.view',
    'inbound.arrival_scan',
    'inbound.receive',
    'inbound.qc',
    'inbound.putaway',
  )
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id)
  }

  @RequirePerms('create_inbound.create')
  @Post()
  create(@Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.create(body, userId)
  }

  @RequirePerms('inbound.receive')
  @Post(':id/receive-box')
  receiveBox(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.receiveBox(id, body, userId)
  }

  @RequirePerms('inbound.receive')
  @Post(':id/received-carton-count')
  recordReceivedCartonCount(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { receivedCartonCount?: number },
    @CurrentUser('userId') userId: number,
  ) {
    return this.service.recordReceivedCartonCount(id, body, userId)
  }

  @RequirePerms('inbound.receive')
  @Post(':id/start-receive')
  startReceive(@Param('id', ParseIntPipe) id: number, @CurrentUser('userId') userId: number) {
    return this.service.startReceive(id, userId)
  }

  @RequirePerms('inbound.qc')
  @Post(':id/qc')
  qc(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.qc(id, body, userId)
  }

  @RequirePerms('inbound.qc')
  @Post(':id/scan-qc')
  scanQc(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.scanQc(id, body, userId)
  }

  @RequirePerms('inbound.qc')
  @Post(':id/scan-receipt-label')
  scanReceiptLabel(@Param('id', ParseIntPipe) id: number, @Body() body: { scanCode?: string }) {
    return this.service.scanReceiptLabel(id, body?.scanCode || '')
  }

  @RequireAnyPerm('inbound.handle_exception', 'inbound.confirm_diff')
  @Post(':id/resolve-exception')
  resolveException(@Param('id', ParseIntPipe) id: number, @Body() body: { reason?: string }, @CurrentUser('userId') userId: number) {
    return this.service.resolveException(id, body, userId)
  }

  @RequirePerms('inbound.putaway')
  @Post(':id/measure-dimensions')
  measureDimensions(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.measureDimensions(id, body, userId)
  }

  @RequirePerms('inbound.putaway')
  @Post(':id/putaway')
  putaway(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.putaway(id, body, userId)
  }

  /** @deprecated 兼容旧流程，内部走 qc + 默认待上架区 putaway */
  @RequireAnyPerm('inbound.confirm_diff', 'inbound.putaway')
  @Post(':id/confirm')
  confirm(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.confirm(id, body, userId)
  }
}
