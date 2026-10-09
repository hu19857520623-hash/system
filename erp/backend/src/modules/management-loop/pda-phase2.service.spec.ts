import { BadRequestException } from '@nestjs/common'
import { InboundService } from '../inbound/inbound.service'
import { OutboundService } from '../outbound/outbound.service'
import { ManagementLoopService } from './management-loop.service'

describe('PDA phase 2 warehouse exception flows', () => {
  it('requires a reason when the received carton count differs from the expected count', async () => {
    const prisma: any = {
      inboundCarton: { count: jest.fn().mockResolvedValue(0) },
      inboundOrder: { update: jest.fn() },
    }
    const opLog = { log: jest.fn(), hasClientRequest: jest.fn().mockResolvedValue(false) }
    const service = new InboundService(
      prisma,
      {} as any,
      opLog as any,
      {} as any,
      {} as any,
      {} as any,
    )
    jest.spyOn(service, 'detail').mockResolvedValue({
      id: 6,
      inboundNo: 'IN-6',
      status: 'receiving',
      cartons: [{}, {}, {}],
      items: [],
    } as any)

    await expect(service.recordReceivedCartonCount(6, { receivedCartonCount: 2 }, 11))
      .rejects.toThrow(new BadRequestException('实收 2 箱与应收 3 箱不一致，请填写差异原因'))
    expect(prisma.inboundOrder.update).not.toHaveBeenCalled()
    expect(opLog.log).not.toHaveBeenCalled()
  })

  it('records an inbound unknown barcode without changing the order status', async () => {
    const opLog = { log: jest.fn().mockResolvedValue(undefined) }
    const service = new InboundService(
      {} as any,
      {} as any,
      opLog as any,
      {} as any,
      {} as any,
      {} as any,
    )
    jest.spyOn(service, 'detail').mockResolvedValue({
      id: 7,
      inboundNo: 'IN-7',
      status: 'receiving',
      items: [],
    } as any)

    await expect(service.reportException(7, {
      exceptionType: 'unknown_barcode',
      scanCode: 'UNKNOWN-990',
      remark: '放异常区',
    }, 12)).resolves.toEqual(expect.objectContaining({ message: expect.stringContaining('已登记') }))
    expect(opLog.log).toHaveBeenCalledWith(expect.objectContaining({
      operatorId: 12,
      action: 'report_exception',
      detail: expect.objectContaining({ exceptionType: 'unknown_barcode', scanCode: 'UNKNOWN-990' }),
    }))
  })

  it('marks a short pick as a problem and writes an audit entry', async () => {
    const prisma: any = {
      outboundOrder: {
        findUnique: jest.fn().mockResolvedValue({ id: 8n, outboundNo: 'OUT-8', status: 'picking', problemRemark: null }),
        update: jest.fn().mockResolvedValue({}),
      },
    }
    const opLog = { log: jest.fn().mockResolvedValue(undefined), hasClientRequest: jest.fn().mockResolvedValue(false) }
    const service = new OutboundService(prisma, {} as any, {} as any, {} as any, {} as any, opLog as any)
    jest.spyOn(service, 'detail').mockResolvedValue({ id: 8, outboundNo: 'OUT-8', isProblem: true } as any)

    await service.setProblem(8, {
      markType: 'problem',
      problemType: 'stock_short',
      problemRemark: 'A-01 应拣10 实拣7 缺3',
      clientRequestId: 'req-short-8',
    }, 21)

    expect(prisma.outboundOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isProblem: true, problemType: 'stock_short' }),
    }))
    expect(opLog.log).toHaveBeenCalledWith(expect.objectContaining({
      operatorId: 21,
      action: 'set_problem',
      detail: expect.objectContaining({ clientRequestId: 'req-short-8' }),
    }))
  })

  it('rejects a recount performed by the first counter', async () => {
    const prisma: any = {
      stocktakePlan: { findUnique: jest.fn().mockResolvedValue({ id: 3n, stocktakeNo: 'PD-3', status: 'counting' }) },
      stocktakeLine: { findFirst: jest.fn().mockResolvedValue({ id: 4n, firstQty: 9, firstCountedBy: 31n, bookQty: 10 }) },
      operationLog: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    }
    const service = new ManagementLoopService(prisma, { hasClientRequest: jest.fn().mockResolvedValue(false) } as any, {} as any)

    await expect(service.submitCount(3, { lineId: 4, qty: 10 }, 31)).rejects.toThrow(
      new BadRequestException('复盘必须由另一名作业员完成，请交接给其他账号'),
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
