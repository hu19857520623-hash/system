import { InboundService } from './inbound.service'
import * as receiving from './inbound-receiving-transaction.util'
import { InboundController } from './inbound.controller'
import { PERMS_KEY } from '../../common/decorators/require-perms.decorator'

describe('作业成功后的费用同步失败反馈', () => {
  afterEach(() => jest.restoreAllMocks())
  it('保留已提交结果并明确待同步，原请求重试使用原实收数量且不要求当前状态仍可清点', async () => {
    const core = jest.spyOn(receiving, 'runInboundReceiving').mockResolvedValueOnce({ id: 1, status: 'pending_putaway', measuredCount: 1, items: [{ actualQty: 2 }] } as any).mockResolvedValueOnce({ id: 1, duplicate: true, status: 'pending_putaway', measuredCount: 1, items: [{ actualQty: 2 }] } as any)
    const prisma = { inboundOrder: { findUnique: jest.fn().mockResolvedValue({ inboundNo: 'RV-A', status: 'completed', items: [{ actualQty: 99 }] }) } }
    const fees = { recordOperation: jest.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue(null) }
    const service = new InboundService(prisma as any, null as any, null as any, null as any, null as any, fees as any)
    const input: any = { clientRequestId: '8edaf540-168b-489c-b6a9-dce602503815' }
    expect(await service.qcAndMeasure(1, input, 1)).toMatchObject({ status: 'pending_putaway', feePending: true, warning: expect.stringContaining('作业已保存') })
    expect(await service.qcAndMeasure(1, input, 1)).toMatchObject({ duplicate: true })
    expect(core.mock.calls[0]).toEqual(core.mock.calls[1])
    expect(fees.recordOperation.mock.calls.map(call => call.slice(1))).toEqual([['qc', 2, true], ['qc', 2, true], ['measure', 1, true]])
  })
  it('后续读取失败不能把已经提交的作业报成提交失败', async () => {
    jest.spyOn(receiving, 'runInboundReceiving').mockResolvedValue({ id: 1, status: 'pending_putaway', measuredCount: 1 } as any)
    const prisma = { inboundOrder: { findUnique: jest.fn().mockRejectedValue(new Error('unavailable')) } }
    const service = new InboundService(prisma as any, null as any, null as any, null as any, null as any, {} as any)
    expect(await service.measureDimensions(1, {} as any, 1)).toMatchObject({ status: 'pending_putaway', feePending: true })
  })
  it('合并接口必须同时具备清点与测量上架权限，单项接口保留各自权限', () => {
    expect(Reflect.getMetadata(PERMS_KEY, InboundController.prototype.qcAndMeasure)).toEqual(['inbound.qc', 'inbound.putaway'])
    expect(Reflect.getMetadata(PERMS_KEY, InboundController.prototype.qc)).toEqual(['inbound.qc'])
    expect(Reflect.getMetadata(PERMS_KEY, InboundController.prototype.measureDimensions)).toEqual(['inbound.putaway'])
  })
})
