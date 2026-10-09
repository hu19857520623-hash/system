import { OutboundService } from './outbound.service'

describe('outbound exception synchronization', () => {
  function setup(status = 'picking') {
    const service = Object.create(OutboundService.prototype) as OutboundService
    const prisma = {
      outboundOrder: {
        findUnique: jest.fn().mockResolvedValue({ id: 1n, outboundNo: 'OUT-1', status, exceptionFromStatus: 'picking' }),
        update: jest.fn().mockResolvedValue({}),
      },
    }
    const push = jest.fn().mockResolvedValue(undefined)
    Object.assign(service, { prisma, opLog: { log: jest.fn().mockResolvedValue(undefined) }, pushOutboundStatusToOms: push, detail: jest.fn().mockResolvedValue({}) })
    return { service, prisma, push }
  }

  it('pushes the exception status after saving the type and explanation', async () => {
    const { service, prisma, push } = setup()
    await service.setProblem(1, { markType: 'exception', exceptionType: 'document_missing', problemRemark: '缺少装箱清单\n请补充上传' })
    expect(prisma.outboundOrder.update).toHaveBeenCalledWith({ where: { id: 1n }, data: {
      exceptionFromStatus: 'picking', exceptionType: 'document_missing', status: 'exception', problemRemark: '缺少装箱清单\n请补充上传',
    } })
    expect(push).toHaveBeenCalledWith('OUT-1')
    expect(prisma.outboundOrder.update.mock.invocationCallOrder[0]).toBeLessThan(push.mock.invocationCallOrder[0])
  })

  it('pushes the restored status when the exception is cleared', async () => {
    const { service, prisma, push } = setup('exception')
    await service.setProblem(1, { markType: 'clear_exception' })
    expect(prisma.outboundOrder.update).toHaveBeenCalledWith({ where: { id: 1n }, data: { status: 'picking', exceptionFromStatus: null, exceptionType: null } })
    expect(push).toHaveBeenCalledWith('OUT-1')
  })

  it('does not publish an invalid exception', async () => {
    const { service, push } = setup()
    await expect(service.setProblem(1, { markType: 'exception', exceptionType: 'invalid' })).rejects.toThrow('请选择有效')
    expect(push).not.toHaveBeenCalled()
  })

  it('includes details in the OMS response and clears them after recovery', () => {
    const { service } = setup()
    const order = { id: 1n, outboundNo: 'OUT-1', status: 'exception', exceptionType: 'document_missing', problemRemark: '缺少装箱清单', items: [], attachments: [] }
    expect((service as any).mapOutboundForOms(order)).toMatchObject({ omsStatus: 'exception', exceptionCode: 'document_missing', exceptionReason: '缺少装箱清单' })
    expect((service as any).mapOutboundForOms({ ...order, status: 'picking', exceptionType: null })).toMatchObject({ exceptionCode: null, exceptionReason: null })
  })
})
