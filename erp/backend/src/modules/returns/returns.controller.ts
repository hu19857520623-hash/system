import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import { ReturnsService } from './returns.service'
import { PaginationDto } from '../../common/dto/pagination.dto'
import { Public } from '../../common/decorators/public.decorator'
import { RequireAnyPerm, RequirePerms } from '../../common/decorators/require-perms.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@Controller('returns')
export class ReturnsController {
  constructor(private readonly service: ReturnsService) {}

  @Public()
  @Post('oms')
  omsCreate(@Body() body: any) {
    return this.service.createFromOms(body)
  }

  @Public()
  @Get('oms/by-customer/:customerCode')
  omsListByCustomer(@Param('customerCode') customerCode: string) {
    return this.service.listByOmsCustomer(customerCode)
  }

  @Public()
  @Get('oms/by-no/:returnNo')
  omsGetByNo(@Param('returnNo') returnNo: string) {
    return this.service.getByReturnNoForOms(returnNo)
  }

  @Public()
  @Post('oms/by-no/:returnNo/cancel')
  omsCancel(@Param('returnNo') returnNo: string, @Body() body: { customerCode?: string }) {
    return this.service.cancelFromOms(returnNo, body?.customerCode)
  }

  @Public()
  @Post('oms/by-no/:returnNo/decide')
  omsDecide(
    @Param('returnNo') returnNo: string,
    @Body() body: { customerCode?: string; decision: 'keep' | 'discard'; processChoice?: string },
  ) {
    return this.service.decideFromOms(returnNo, body)
  }

  @Public()
  @Get('oms/by-no/:returnNo/attachment/:attachmentId')
  async omsDownloadAttachment(
    @Param('returnNo') returnNo: string,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @Res() res: Response,
  ) {
    const file = await this.service.downloadAttachmentByReturnNo(returnNo, attachmentId)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  }

  @RequireAnyPerm('return.view', 'inbound.view')
  @Get('fee-templates')
  listFeeTemplates() {
    return this.service.listFeeTemplates()
  }

  @RequireAnyPerm('return.view', 'inbound.view')
  @Get('fee-templates/active')
  getActiveFeeTemplate(@Query() q: { customerId?: string; warehouseCode?: string }) {
    const customerId = q.customerId ? Number(q.customerId) : undefined
    return this.service.getActiveFeeTemplate(customerId, q.warehouseCode)
  }

  @RequirePerms('return.receive')
  @Post('fee-templates')
  createFeeTemplate(
    @Body() body: {
      templateName?: string
      warehouseCode: string
      rules: {
        chargeType?: string
        description?: string
        calcMode?: string
        unitPrice?: number
        minQty?: number | null
        sortOrder?: number
        autoApply?: boolean
      }[]
    },
    @CurrentUser('userId') userId: number,
  ) {
    return this.service.createFeeTemplate(body, userId)
  }

  @RequirePerms('return.receive')
  @Put('fee-templates/:id')
  updateFeeTemplate(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: {
      templateName?: string
      warehouseCode?: string | null
      customerId?: number | null
      rules: {
        chargeType?: string
        description?: string
        calcMode?: string
        unitPrice?: number
        minQty?: number | null
        sortOrder?: number
        autoApply?: boolean
      }[]
    },
    @CurrentUser('userId') userId: number,
  ) {
    return this.service.updateFeeTemplate(id, body, userId)
  }

  @RequirePerms('return.receive')
  @Delete('fee-templates/:id')
  deleteFeeTemplate(@Param('id', ParseIntPipe) id: number, @CurrentUser('userId') userId: number) {
    return this.service.deleteFeeTemplate(id, userId)
  }

  @RequireAnyPerm('return.view', 'inbound.view')
  @Get()
  list(
    @Query()
    q: PaginationDto & {
      status?: string
      keyword?: string
      customerCode?: string
      returnWarehouse?: string
      requestedProcess?: string
      processResult?: string
      returnReason?: string
      sku?: string
      returnNo?: string
      orderNo?: string
      trackingNo?: string
      sellerTaxNo?: string
      referenceNo?: string
      createdFrom?: string
      createdTo?: string
      expectedArrivalFrom?: string
      expectedArrivalTo?: string
      receivedFrom?: string
      receivedTo?: string
      processedFrom?: string
      processedTo?: string
    },
  ) {
    return this.service.list(q)
  }

  @RequireAnyPerm('return.view', 'inbound.view')
  @Get(':id/attachment/:attachmentId')
  async downloadAttachment(
    @Param('id', ParseIntPipe) id: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @Res() res: Response,
  ) {
    const file = await this.service.downloadAttachment(id, attachmentId)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(file.content)
  }

  @RequireAnyPerm('return.view', 'inbound.view')
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id)
  }

  @RequirePerms('return.receive')
  @Post(':id/receive')
  receive(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { receivedQty?: number; receivedCartonCount?: number; remark?: string },
    @CurrentUser('userId') userId: number,
  ) {
    return this.service.receive(id, body, userId)
  }

  @RequirePerms('return.receive')
  @Post(':id/measure')
  measure(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { cartons: { lengthCm: number; widthCm: number; heightCm: number; grossWeightKg: number }[] },
    @CurrentUser('userId') userId: number,
  ) {
    return this.service.measure(id, body, userId)
  }

  @RequirePerms('return.receive')
  @Post(':id/fee-preview')
  previewFees(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: {
      cartons: { lengthCm: number; widthCm: number; heightCm: number; grossWeightKg: number }[]
      extraLines?: { description?: string; amount?: number; quantity?: number; unitPrice?: number }[]
    },
  ) {
    return this.service.previewReturnFees(id, body)
  }

  @RequirePerms('return.receive')
  @Post(':id/calculate-fees')
  calculateFees(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { extraLines?: { description?: string; amount?: number; quantity?: number; unitPrice?: number }[] },
    @CurrentUser('userId') userId: number,
  ) {
    return this.service.calculateFees(id, userId, body)
  }

  @RequirePerms('return.receive')
  @Post(':id/inspect')
  submitInspection(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: {
      inspectionResult: string
      inspectionRemark?: string
      attachments?: { fileName: string; contentBase64?: string; url?: string }[]
    },
    @CurrentUser('userId') userId: number,
  ) {
    return this.service.submitInspection(id, body, userId)
  }

  @RequirePerms('return.process')
  @Post(':id/dispose')
  executeDispose(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { processRemark?: string },
    @CurrentUser('userId') userId: number,
  ) {
    return this.service.executeDispose(id, body, userId)
  }

  @RequirePerms('return.process')
  @Post(':id/process')
  process(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { processResult: string; processRemark?: string },
    @CurrentUser('userId') userId: number,
  ) {
    return this.service.process(id, body, userId)
  }
}
