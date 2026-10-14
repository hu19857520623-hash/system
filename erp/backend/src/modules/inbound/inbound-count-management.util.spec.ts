import { assertCountManagement, manageInboundCount } from './inbound-count-management.util'

describe('inbound count correction and zero receipt', () => {
  const zero = { id: 1n, inboundNo: 'RV-1', status: 'pending_putaway', items: [{ sku: 'TKL005-1', actualQty: 0, putawayQty: 0 }], putawayItems: [] }
  it('allows explicit zero completion, including an exception with zero receipts', () => {
    expect(() => assertCountManagement(zero, 'close-zero')).not.toThrow()
    expect(() => assertCountManagement({ ...zero, status: 'exception' }, 'close-zero')).not.toThrow()
  })
  it('does not treat an uncounted quantity or positive receipt as zero', () => {
    for (const actualQty of [null, undefined, 1]) expect(() => assertCountManagement({ ...zero, items: [{ actualQty }] }, 'close-zero')).toThrow()
  })
  it('blocks corrections for stock already put away and ordinary completed orders', () => {
    expect(() => assertCountManagement({ ...zero, items: [{ actualQty: 2, putawayQty: 1 }] }, 'reopen')).toThrow('上架')
    expect(() => assertCountManagement({ ...zero, status: 'completed', items: [{ actualQty: 2 }] }, 'reopen')).toThrow()
    expect(() => assertCountManagement({ ...zero, status: 'completed' }, 'reopen')).not.toThrow()
  })
  it('writes completion and its reason together without changing inventory', async () => {
    const tx = {
      $queryRaw: jest.fn(),
      inboundOrder: { findUnique: jest.fn().mockResolvedValue(zero), update: jest.fn().mockResolvedValue({ ...zero, status: 'completed' }) },
      operationLog: { create: jest.fn() },
    }
    const prisma = { $transaction: (fn: any) => fn(tx) }
    await manageInboundCount(prisma, 1, 'close-zero', '实际未收到货物', 7)
    expect(tx.inboundOrder.update).toHaveBeenCalledWith({ where: { id: 1n }, data: { status: 'completed', confirmedAt: expect.any(Date) } })
    expect(tx.operationLog.create.mock.calls[0][0].data.detail.reason).toBe('实际未收到货物')
  })
})
