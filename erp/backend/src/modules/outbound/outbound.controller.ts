import { BadRequestException, Body, Controller, Get, Header, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import { OutboundService, OutboundListQuery } from './outbound.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequireAnyPerm, RequirePerms } from '../../common/decorators/require-perms.decorator'
import { OmsBridge } from '../../common/decorators/oms-bridge.decorator'
import { CreateOmsOutboundDto } from './dto/oms-outbound.dto'
import { AssignPickerDto, PickOutboundDto } from './dto/pick-outbound.dto'

function sendPdf(res: Response, file: { fileName: string; content: Buffer }) {
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`)
  res.setHeader('Content-Length', String(file.content.length))
  res.send(file.content)
}

@Controller('outbound')
export class OutboundController {
  constructor(private readonly service: OutboundService) {}

  /** OMS P1：客户预约出库 */
  @OmsBridge()
  @Post('oms')
  omsCreate(@Body() body: CreateOmsOutboundDto) {
    return this.service.createFromOms(body)
  }

  @OmsBridge()
  @Get('oms/by-customer/:customerCode')
  omsListByCustomer(@Param('customerCode') customerCode: string) {
    return this.service.listByOmsCustomer(customerCode)
  }

  @OmsBridge()
  @Get('oms/by-customer/:customerCode/sku/:sku/outbounds')
  omsSkuOutbounds(
    @Param('customerCode') customerCode: string,
    @Param('sku') sku: string,
  ) {
    return this.service.listSkuOutboundsForOms(customerCode, sku)
  }

  @OmsBridge()
  @Get('oms/by-customer/:customerCode/logistics')
  omsLogisticsByCustomer(@Param('customerCode') customerCode: string) {
    return this.service.listLogisticsByOmsCustomer(customerCode)
  }

  @OmsBridge()
  @Get('oms/by-no/:outboundNo')
  omsGetByNo(@Param('outboundNo') outboundNo: string) {
    return this.service.getByOutboundNoForOms(outboundNo)
  }

  /** OMS 客户回传 POD 签收单文件 */
  @OmsBridge()
  @Post('oms/by-no/:outboundNo/pod')
  omsUploadPod(@Param('outboundNo') outboundNo: string, @Body() body: any) {
    return this.service.uploadPodFromOms(outboundNo, body)
  }

  /** OMS 下载 POD 签收单 */
  @OmsBridge()
  @Get('oms/by-no/:outboundNo/pod')
  async omsDownloadPod(
    @Param('outboundNo') outboundNo: string,
    @Query('customerCode') customerCode: string,
    @Res() res: Response,
  ) {
    const file = await this.service.downloadPodForOms(outboundNo, customerCode)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  }

  @RequirePerms('outbound.view')
  @Get('status-counts')
  statusCounts(@Query() q: OutboundListQuery) {
    return this.service.statusCounts(q)
  }

  @RequirePerms('outbound.view')
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="outbound-export.csv"')
  async exportList(@Query() q: OutboundListQuery, @Res() res: Response) {
    res.send(await this.service.exportList(q))
  }

  @RequirePerms('outbound.view')
  @Get()
  list(@Query() q: OutboundListQuery) {
    return this.service.list(q)
  }

  @RequirePerms('outbound.pick')
  @Post('assign-picker')
  assignPicker(@Body() body: AssignPickerDto) {
    return this.service.assignPicker(body.ids || [], body.pickerId)
  }

  @RequirePerms('outbound.view')
  @Get(':id/attachment/:attachmentId')
  @Header('Content-Type', 'application/octet-stream')
  async downloadAttachmentById(
    @Param('id', ParseIntPipe) id: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @Res() res: Response,
  ) {
    const file = await this.service.downloadAttachment(id, attachmentId)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  }

  @RequirePerms('outbound.view')
  @Get(':id/attachment')
  @Header('Content-Type', 'application/octet-stream')
  async downloadAttachment(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const file = await this.service.downloadAttachment(id)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  }

  @RequireAnyPerm('outbound.view', 'outbound.pick')
  @Get(':id/pick-suggestions')
  pickSuggestions(@Param('id', ParseIntPipe) id: number) {
    return this.service.getPickSuggestions(id)
  }

  @RequireAnyPerm('outbound.view', 'outbound.pick')
  @Get(':id/pick-list')
  @Header('Content-Type', 'text/html;charset=utf-8')
  async pickList(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const file = await this.service.buildPickListHtml(id)
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  }

  @RequirePerms('outbound.view')
  @Get(':id/labels/sku/:sku/unit/:unitIndex')
  async downloadUnitLabel(
    @Param('id', ParseIntPipe) id: number,
    @Param('sku') sku: string,
    @Param('unitIndex', ParseIntPipe) unitIndex: number,
    @Res() res: Response,
  ) {
    sendPdf(res, await this.service.downloadUnitLabel(id, sku, unitIndex))
  }

  @RequirePerms('outbound.view')
  @Get(':id/labels/sku/:sku')
  async downloadSkuLabels(
    @Param('id', ParseIntPipe) id: number,
    @Param('sku') sku: string,
    @Res() res: Response,
  ) {
    sendPdf(res, await this.service.downloadSkuLabels(id, sku))
  }

  @RequirePerms('outbound.view')
  @Get(':id/labels')
  async downloadOutboundLabels(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    sendPdf(res, await this.service.downloadOutboundLabels(id))
  }

  @RequirePerms('outbound.view')
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id)
  }

  /** ERP 不再手动创建出库单，统一由 OMS 客户预约后同步 */
  @RequirePerms('outbound.create')
  @Post()
  create() {
    throw new BadRequestException('出库单请由客户在 OMS 预约创建，ERP 仅负责拣货、打包与发运')
  }

  @RequirePerms('outbound.create')
  @Post(':id/attachment')
  uploadAttachment(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.uploadAttachment(id, body)
  }

  @RequirePerms('outbound.create')
  @Post(':id/problem')
  setProblem(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.setProblem(id, body)
  }

  @RequirePerms('outbound.relabel')
  @Post(':id/confirm-relabel')
  confirmRelabel(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.confirmRelabel(id, body)
  }

  @RequirePerms('outbound.pick')
  @Post(':id/pick')
  pick(@Param('id', ParseIntPipe) id: number, @Body() body: PickOutboundDto, @CurrentUser('userId') userId: number) {
    return this.service.pick(id, body, userId)
  }

  @RequirePerms('outbound.pack')
  @Post(':id/start-review')
  startReview(@Param('id', ParseIntPipe) id: number) {
    return this.service.startReview(id)
  }

  @RequirePerms('outbound.pack')
  @Post(':id/pack')
  pack(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.pack(id, body, userId)
  }

  @RequirePerms('outbound.ship')
  @Post(':id/deliver')
  deliver(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.deliver(id, body)
  }

  @RequirePerms('outbound.create')
  @Post(':id/appointment')
  setAppointment(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.setAppointment(id, body)
  }

  @RequirePerms('outbound.ship')
  @Post(':id/ship')
  ship(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser('userId') userId: number) {
    return this.service.ship(id, userId, body)
  }

  @RequirePerms('outbound.create')
  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.service.cancel(id)
  }
}
