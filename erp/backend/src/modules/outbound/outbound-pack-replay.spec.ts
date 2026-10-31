import { OutboundService } from './outbound.service'

function fixture() {
  let order: any = { id: 62n, outboundNo: 'OB-62', status: 'picked', needsRelabel: false, isPalletized: true, palletInfo: '旧托盘', remark: '', items: [{ id: 34n, sku: 'A', qty: 2, pickedQty: 2 }] }
  let receipts: any[] = [], tail = Promise.resolve()
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    sysUser: { findUnique: jest.fn(async () => ({ realName: '测试复核员', username: 'reviewer' })) },
    outboundOrder: { findUnique: jest.fn(async () => structuredClone(order)), updateMany: jest.fn(async ({ where, data }: any) => {
      if (where.status !== order.status) return { count: 0 }
      Object.assign(order, data);return { count: 1 }
    }) },
    operationLog: { findFirst: jest.fn(async ({ where }: any) => receipts.find(r => where.action.in.includes(r.action) && r.detail.clientRequestId === where.detail.equals)),
      create: jest.fn(async ({ data }: any) => { receipts.push(data);return data }) },
  }
  const db: any = { ...tx, $transaction: (work: any) => {
    const result = tail.then(async () => { const original = structuredClone(order), logs = structuredClone(receipts)
      try { return await work(tx) } catch (e) { order = original;receipts = logs;throw e } })
    tail = result.catch(() => {});return result
  } }
  const service = new OutboundService(db, {} as any, {} as any, {} as any, {} as any, {} as any)
  jest.spyOn(service, 'detail').mockImplementation(async () => ({ id: 62, outboundNo: order.outboundNo, status: order.status }) as any)
  const payload = { clientRequestId: 'original-pack', reviewSource: 'pick_list' as const, isPalletized: false, palletInfo: '', cartons: [{ lengthCm: 30, widthCm: 20, heightCm: 10, grossWeightKg: 2 }] }
  return { service, tx, payload, get order() { return order }, get receipts() { return receipts }, setReceipts: (r: any[]) => { receipts = r } }
}

describe('复核打包原请求和状态推进', () => {
  it('并发相同请求只更新一次，已发运后重试不会回退状态', async () => {
    const f = fixture(), results = await Promise.all([f.service.pack(62, f.payload, 61), f.service.pack(62, f.payload, 61)])
    expect(results.filter(r => (r as any).duplicate)).toHaveLength(1)
    expect(f.tx.outboundOrder.updateMany).toHaveBeenCalledTimes(1);expect(f.receipts).toHaveLength(1)
    expect(f.order.status).toBe('packed');expect(f.order.palletInfo).toBeNull()
    f.order.status = 'shipped'
    await expect(f.service.pack(62, f.payload, 61)).resolves.toMatchObject({ duplicate: true, status: 'shipped' })
    expect(f.tx.outboundOrder.updateMany).toHaveBeenCalledTimes(1)
  })
  it.each([{ targetId: 'OTHER', operatorId: 61n }, { targetId: 'OB-62', operatorId: 51n }])('跨单或跨账号不接受旧回执 %p', async identity => {
    const f = fixture();f.setReceipts([{ action: 'pack', ...identity, detail: { clientRequestId: f.payload.clientRequestId } }])
    await expect(f.service.pack(62, f.payload, 61)).rejects.toThrow('其它账号或出库单')
    expect(f.tx.outboundOrder.updateMany).not.toHaveBeenCalled()
  })
  it.each([{ isPalletized: true }, { palletInfo: '更换托盘' }, { cartons: [{ lengthCm: 31, widthCm: 20, heightCm: 10, grossWeightKg: 2 }] }, { cartons: [{ lengthCm: 30, widthCm: 20, heightCm: 10, grossWeightKg: 3 }] }])('原请求不能更换实测或打托资料 %p', async patch => {
    const f = fixture();await f.service.pack(62, f.payload, 61)
    await expect(f.service.pack(62, { ...f.payload, ...patch }, 61)).rejects.toThrow('不能更改')
    expect(f.tx.outboundOrder.updateMany).toHaveBeenCalledTimes(1)
  })
  it('历史回执没有原明细时只允许查询结果，不能猜测明细重放', async () => {
    const f = fixture();f.setReceipts([{ action: 'pack', targetId: 'OB-62', operatorId: 61n, detail: { clientRequestId: f.payload.clientRequestId, cartonCount: 1 } }])
    await expect(f.service.pack(62, f.payload, 61)).rejects.toThrow('历史复核记录缺少原明细')
    await expect(f.service.packRequest(62, f.payload.clientRequestId, 61)).resolves.toMatchObject({ outcome: 'confirmed' })
    expect(f.tx.outboundOrder.updateMany).not.toHaveBeenCalled()
  })
  it('取消先完成后迟到提交被阻止；完成后取消保持已完成', async () => {
    const f = fixture()
    await expect(f.service.cancelPackRequest(62, f.payload.clientRequestId, 61)).resolves.toMatchObject({ outcome: 'cancelled' })
    await expect(f.service.pack(62, f.payload, 61)).rejects.toThrow('已取消')
    await expect(f.service.packRequest(62, f.payload.clientRequestId, 61)).resolves.toMatchObject({ outcome: 'cancelled' })
    expect(f.tx.outboundOrder.updateMany).not.toHaveBeenCalled()
    await f.service.pack(62, { ...f.payload, clientRequestId: 'new-original' }, 61)
    await expect(f.service.cancelPackRequest(62, 'new-original', 61)).resolves.toMatchObject({ outcome: 'confirmed' })
    expect(f.order.status).toBe('packed')
  })
  it('开始复核与打包并发不会把已打包单退回复核中', async () => {
    const f = fixture();await Promise.all([f.service.startReview(62, 61), f.service.pack(62, f.payload, 61)])
    expect(f.order.status).toBe('packed')
    await expect(f.service.startReview(62, 61)).rejects.toThrow('仅已拣货状态')
    expect(f.order.status).toBe('packed')
  })
  it('重复开始复核只写一个状态与一份日志', async () => {
    const f = fixture();await Promise.all([f.service.startReview(62, 61), f.service.startReview(62, 61)])
    expect(f.tx.outboundOrder.updateMany).toHaveBeenCalledTimes(1);expect(f.receipts).toHaveLength(1)
  })
  it('日志失败与复核状态一同回滚', async () => {
    const f = fixture();f.tx.operationLog.create.mockRejectedValueOnce(new Error('日志暂不可用'))
    await expect(f.service.pack(62, f.payload, 61)).rejects.toThrow('日志暂不可用')
    expect(f.order.status).toBe('picked');expect(f.order.remark).toBe('');expect(f.receipts).toEqual([])
  })
  it('显式清空打托资料不保留旧值，也不把空值作为服务器错误', async () => {
    const f = fixture()
    await expect(f.service.pack(62, { ...f.payload, isPalletized: true, palletInfo: null as any }, 61)).resolves.toMatchObject({ status: 'packed' })
    expect(f.order.palletInfo).toBeNull()
  })
})
