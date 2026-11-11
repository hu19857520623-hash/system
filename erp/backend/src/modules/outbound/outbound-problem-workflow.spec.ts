import { OutboundService } from './outbound.service'

describe('outbound problem atomic workflow', () => {
  const payload = { markType: 'problem' as const, problemType: 'stock_short', problemRemark: '缺货待核对', clientRequestId: 'problem-retry-test' }
  function setup() {
    let state: any = { id: 1n, outboundNo: 'DO-ONE', status: 'picking', isProblem: false }
    let receipt: any = null
    const tx: any = {
      $queryRaw: jest.fn(), sysUser: { findUnique: jest.fn().mockResolvedValue({ realName: '仓库员' }) },
      outboundOrder: {
        findUnique: jest.fn(async () => ({ ...state })),
        update: jest.fn(async ({ data }) => { state = { ...state, ...data }; return state }),
      },
      operationLog: { findFirst: jest.fn(async () => receipt), create: jest.fn(async ({ data }) => { receipt = data; return data }) },
    }
    const prisma: any = { $transaction: jest.fn(async fn => {
      const before = { ...state }, oldReceipt = receipt
      try { return await fn(tx) } catch (e) { state = before; receipt = oldReceipt; throw e }
    }) }
    const service = new OutboundService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any)
    jest.spyOn(service, 'detail').mockImplementation(async () => ({ ...state }) as any)
    return { service, tx, state: () => state, receipt: () => receipt, setReceipt: (r: any) => { receipt = r } }
  }

  it('rolls back a marker when its required audit write fails and retries the original action', async () => {
    const f = setup()
    f.tx.operationLog.create.mockRejectedValueOnce(new Error('audit unavailable'))
    await expect(f.service.setProblem(1, payload, 7)).rejects.toThrow('audit unavailable')
    expect(f.state().isProblem).toBe(false)
    expect(f.receipt()).toBeNull()
    await expect(f.service.setProblem(1, payload, 7)).resolves.toMatchObject({ isProblem: true })
    const writes = f.tx.outboundOrder.update.mock.calls.length
    await expect(f.service.setProblem(1, payload, 7)).resolves.toMatchObject({ duplicate: true })
    expect(f.tx.outboundOrder.update).toHaveBeenCalledTimes(writes)
  })

  it('rejects a request replay against another order or with changed content or actor', async () => {
    const f = setup()
    await f.service.setProblem(1, payload, 7)
    const original = f.receipt()
    for (const patch of [{ targetId: 'DO-OTHER' }, { operatorId: 8n }, { detail: { ...original.detail, requestFingerprint: 'different' } }]) {
      f.setReceipt({ ...original, ...patch })
      await expect(f.service.setProblem(1, payload, 7)).rejects.toThrow('原标记请求')
    }
    f.setReceipt(original)
    await expect(f.service.setProblem(1, { ...payload, problemRemark: '变更内容' }, 7)).rejects.toThrow('原标记请求')
    expect(f.tx.outboundOrder.update).toHaveBeenCalledTimes(1)
  })

  it('does not modify cancelled orders or create a receipt for rejected operations', async () => {
    const f = setup()
    f.tx.outboundOrder.findUnique.mockResolvedValue({ id: 1n, outboundNo: 'DO-ONE', status: 'cancelled' })
    await expect(f.service.setProblem(1, payload, 7)).rejects.toThrow('已取消')
    expect(f.tx.operationLog.create).not.toHaveBeenCalled()
    expect(f.tx.outboundOrder.update).not.toHaveBeenCalled()
  })
})
