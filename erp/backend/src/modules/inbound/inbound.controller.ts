import { Body, Controller, Delete, Get, Header, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import { InboundService } from './inbound.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequireAnyPerm, RequirePerms } from '../../common/decorators/require-perms.decorator'
import { OmsBridge } from '../../common/decorators/oms-bridge.decorator'
import { CreateOmsAsnDto } from './dto/oms-asn.dto'
import { ApplyShipmentFreightDto, CreateErpShipmentDto, SaveInboundDraftDto, ShipmentFreightMutationDto, UploadInboundAttachmentDto } from './dto/erp-shipment.dto'
import { MeasureInboundDto, RecordInboundCartonsDto, ScanInboundCartonDto, ScanInboundQcDto, SubmitInboundQcDto } from './dto/inbound-receiving.dto'
import { PutawayInboundDto } from './dto/inbound-putaway.dto'
import { InboundControlDto } from './dto/inbound-control.dto'

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
  @Put('oms/asn/:inboundNo')
  omsUpdateAsn(@Param('inboundNo') inboundNo: string, @Body() body: CreateOmsAsnDto) {
    return this.service.updateAsnFromOms(inboundNo, body)
  }

  @OmsBridge()
  @Post('oms/asn/:inboundNo/cancel')
  omsCancelAsn(
    @Param('inboundNo') inboundNo: string,
    @Body() body: { customerCode?: string },
  ) {
    return this.service.cancelAsnFromOms(inboundNo, { customerCode: String(body?.customerCode || '') })
  }

  @OmsBridge()
  @Post('oms/asn/:inboundNo/reactivate')
  omsReactivateAsn(@Param('inboundNo') inboundNo: string, @Body() body: CreateOmsAsnDto) {
    return this.service.reactivateAsnFromOms(inboundNo, body)
  }

  @OmsBridge()
  @Get('oms/by-customer/:customerCode')
  omsListByCustomer(@Param('customerCode') customerCode: string) {
    return this.service.listByOmsCustomer(customerCode)
  }

  @OmsBridge()
  @Get('oms/by-no/:inboundNo/receiving-list')
  @Header('Content-Type', 'text/html;charset=utf-8')
  async omsReceivingList(
    @Param('inboundNo') inboundNo: string,
    @Query('customerCode') customerCode: string,
    @Res() res: Response,
  ) {
    const file = await this.service.getReceivingListForOms(inboundNo, customerCode)
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
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
  saveDraft(@Body() body: SaveInboundDraftDto, @CurrentUser('userId') userId: number) {
    return this.service.saveDraft(body.draftNo, body.form, userId)
  }

  @RequirePerms('create_inbound.create')
  @Delete('drafts/:draftNo')
  deleteDraft(@Param('draftNo') draftNo: string, @CurrentUser('userId') userId: number) {
    return this.service.deleteDraft(draftNo, userId)
  }

  @RequirePerms('create_inbound.create')
  @Post('attachments')
  uploadAttachment(@Body() body: UploadInboundAttachmentDto, @CurrentUser('userId') userId: number) {
    return this.service.uploadAttachment(body, userId)
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
  list(@Query() q: PaginationDto & { status?: string; source?: string }) {
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

  @RequirePerms('inbound.arrival_scan', 'inbound.qc')
  @Post('catalog-bind')
  bindCatalogInbound(@Body() body: { scanCode: string; warehouseCode: string }, @CurrentUser('userId') userId: number) {
    return this.service.bindCatalogInbound(body, userId)
  }

  @RequirePerms('create_inbound.label')
  @Get(':id/labels/sku')
  @Header('Content-Type', 'application/pdf')
  async skuLabel(@Param('id', ParseIntPipe) id: number, @Query('sku') sku: string, @Res() res: Response) {
    const file = await this.service.getSkuLabel(id, sku)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  }

  @RequirePerms('create_inbound.label')
  @Get(':id/labels/outer')
  @Header('Content-Type', 'application/pdf')
  async outerLabel(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const file = await this.service.getOuterLabel(id)
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
  @Get(':id/receiving-list')
  @Header('Content-Type', 'text/html;charset=utf-8')
  async receivingList(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const file = await this.service.getReceivingList(id)
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`)
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
  create(@Body() body: CreateErpShipmentDto, @CurrentUser('userId') userId: number) {
    return this.service.create(body, userId)
  }

  @RequirePerms('create_inbound.create')
  @Post(':id/sea-freight')
  applySeaFreight(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ApplyShipmentFreightDto,
    @CurrentUser('userId') userId: number,
  ) {
    return this.service.applySeaFreight(id, body, userId)
  }

  @RequirePerms('create_inbound.create')
  @Delete(':id/sea-freight')
  clearSeaFreight(@Param('id', ParseIntPipe) id: number, @Body() body: ShipmentFreightMutationDto, @CurrentUser('userId') userId: number) {
    return this.service.clearSeaFreight(id, body, userId)
  }

  @RequirePerms('create_inbound.create')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser('userId') userId: number) {
    return this.service.remove(id, userId)
  }

  @RequirePerms('inbound.receive')
  @Post(':id/receive-box')
  receiveBox(@Param('id', ParseIntPipe) id: number, @Body() body: ScanInboundCartonDto, @CurrentUser('userId') userId: number) {
    return this.service.receiveBox(id, body, userId)
  }

  @RequirePerms('inbound.receive')
  @Post(':id/received-carton-count')
  recordReceivedCartonCount(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RecordInboundCartonsDto,
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
  @Post(':id/reopen-count')
  reopenCount(@Param('id', ParseIntPipe) id: number, @Body() body: InboundControlDto, @CurrentUser('userId') userId: number) {
    return this.service.manageCount(id, 'reopen', body, userId)
  }

  @RequireAnyPerm('inbound.confirm_diff', 'inbound.handle_exception')
  @Post(':id/close-zero')
  closeZero(@Param('id', ParseIntPipe) id: number, @Body() body: InboundControlDto, @CurrentUser('userId') userId: number) {
    return this.service.manageCount(id, 'close-zero', body, userId)
  }

  @RequirePerms('inbound.qc')
  @Post(':id/qc')
  qc(@Param('id', ParseIntPipe) id: number, @Body() body: SubmitInboundQcDto, @CurrentUser('userId') userId: number) {
    return this.service.qc(id, body, userId)
  }

  @RequirePerms('inbound.qc', 'inbound.putaway')
  @Post(':id/qc-and-measure')
  qcAndMeasure(@Param('id', ParseIntPipe) id: number, @Body() body: SubmitInboundQcDto, @CurrentUser('userId') userId: number) {
    return this.service.qcAndMeasure(id, body, userId)
  }

  @RequirePerms('inbound.qc')
  @Post(':id/scan-qc')
  scanQc(@Param('id', ParseIntPipe) id: number, @Body() body: ScanInboundQcDto, @CurrentUser('userId') userId: number) {
    return this.service.scanQc(id, body, userId)
  }

  @RequirePerms('inbound.qc')
  @Post(':id/reduce-qc')
  reduceQc(@Param('id', ParseIntPipe) id: number, @Body() body: InboundControlDto, @CurrentUser('userId') userId: number) {
    return this.service.reduceQuantity(id, 'qc', body, userId)
  }

  @RequirePerms('inbound.receive')
  @Post(':id/reduce-carton')
  reduceCarton(@Param('id', ParseIntPipe) id: number, @Body() body: InboundControlDto, @CurrentUser('userId') userId: number) {
    return this.service.reduceQuantity(id, 'carton', body, userId)
  }

  @RequirePerms('inbound.putaway')
  @Post(':id/reduce-putaway')
  reducePutaway(@Param('id', ParseIntPipe) id: number, @Body() body: InboundControlDto, @CurrentUser('userId') userId: number) {
    return this.service.reduceQuantity(id, 'putaway', body, userId)
  }

  @RequireAnyPerm('inbound.receive', 'inbound.qc', 'inbound.putaway')
  @Post(':id/report-exception')
  reportException(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.reportException(id, body, userId)
  }

  @RequirePerms('inbound.qc')
  @Post(':id/scan-receipt-label')
  scanReceiptLabel(@Param('id', ParseIntPipe) id: number, @Body() body: { scanCode?: string }) {
    return this.service.scanReceiptLabel(id, body?.scanCode || '')
  }

  @RequireAnyPerm('inbound.qc', 'inbound.putaway', 'inbound.handle_exception', 'inbound.confirm_diff')
  @Post(':id/resolve-exception')
  resolveException(@Param('id', ParseIntPipe) id: number, @Body() body: InboundControlDto, @CurrentUser('userId') userId: number) {
    return this.service.resolveException(id, body, userId)
  }

  @RequirePerms('inbound.putaway')
  @Post(':id/measure-dimensions')
  measureDimensions(@Param('id', ParseIntPipe) id: number, @Body() body: MeasureInboundDto, @CurrentUser('userId') userId: number) {
    return this.service.measureDimensions(id, body, userId)
  }

  @RequirePerms('inbound.putaway')
  @Post(':id/putaway')
  putaway(@Param('id', ParseIntPipe) id: number, @Body() body: PutawayInboundDto, @CurrentUser('userId') userId: number) {
    return this.service.putaway(id, body, userId)
  }

  /** @deprecated 旧的一键确认仅说明实际清点、测量与库位上架的正确入口。 */
  @RequireAnyPerm('inbound.confirm_diff', 'inbound.putaway')
  @Post(':id/confirm')
  confirm(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.confirm(id, body, userId)
  }
}
