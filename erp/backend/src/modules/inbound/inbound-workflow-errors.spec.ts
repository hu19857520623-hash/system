import { InboundService } from './inbound.service'

describe('入库流程状态错误的中文反馈', () => {
  function serviceFor(status: string) {
    const row = { id: 1n, inboundNo: 'TEST-INBOUND', status, items: [], cartons: [] }
    const tx = { $queryRaw: jest.fn(), operationLog: { findFirst: jest.fn().mockResolvedValue(null) }, inboundOrder: { findUnique: jest.fn().mockResolvedValue(row) } }
    const prisma = { ...tx, $transaction: (callback: any) => callback(tx) }
    const service = new InboundService(prisma as any, null as any, null as any, null as any, null as any, null as any)
    jest.spyOn(service, 'detail').mockResolvedValue({ id: 1, inboundNo: 'TEST-INBOUND', status, items: [] } as any)
    return service
  }

  it('收货中尝试上架时说明中文状态及恢复步骤', async () => {
    await expect(serviceFor('receiving').putaway(1, { clientRequestId: '8edaf540-168b-489c-b6a9-dce602503815', expectedVersion: 'a'.repeat(64), items: [{ inboundItemId: 1, lines: [{ locationCode: 'A-01', qty: 1 }] }] }, 1)).rejects.toThrow('当前状态「收货中」不可上架，请先完成清点')
  })

  it('未清点时测量说明当前已到仓状态', async () => {
    await expect(serviceFor('arrived').measureDimensions(1, { clientRequestId: '8edaf540-168b-489c-b6a9-dce602503815', expectedVersion: 'a'.repeat(64), items: [{ inboundItemId: 1, lengthCm: 10, widthCm: 20, heightCm: 30 }] }, 1)).rejects.toThrow('当前状态「已到仓」不可测量，请先完成清点')
  })

  it('清点提交后再登记箱数时不暴露 pending_putaway', async () => {
    await expect(serviceFor('pending_putaway').recordReceivedCartonCount(1, { receivedCartonCount: 1, clientRequestId: '8edaf540-168b-489c-b6a9-dce602503815' }, 1))
      .rejects.toThrow('当前状态「待上架」不可登记实收箱数')
  })

  it('不支持的扫码状态使用中文兜底且不显示内部枚举', async () => {
    await expect(serviceFor('future_internal_state').scanQc(1, { scanCode: 'TEST-SKU', clientRequestId: '8edaf540-168b-489c-b6a9-dce602503815' }, 1))
      .rejects.toThrow('当前状态「暂无法识别，请刷新核对」不可扫描清点')
  })

  it('已完结单据拒绝重复上架且返回中文说明', async () => {
    await expect(serviceFor('completed').putaway(1, { clientRequestId: '8edaf540-168b-489c-b6a9-dce602503815', expectedVersion: 'a'.repeat(64), items: [{ inboundItemId: 1, lines: [{ locationCode: 'A-01', qty: 1 }] }] }, 1)).rejects.toThrow('该入库单已完结')
  })
})
