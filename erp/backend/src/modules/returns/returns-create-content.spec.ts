import { ReturnsService } from './returns.service'

describe('return creation content binding', () => {
  it('keeps original retries valid after warehouse progress, but rejects changed fields, quantities and attachments', async () => {
    let row: any = null
    let receipt: any = null
    const tx: any = {
      $queryRaw: jest.fn(), customer: { findUnique: jest.fn().mockResolvedValue({ id: 1n, status: 1 }) },
      operationLog: { findFirst: jest.fn(async () => receipt) },
      returnOrder: {
        findUnique: jest.fn(async () => row),
        create: jest.fn(async ({ data }) => { row = { ...data, id: 2n, items: data.items.create, attachments: [], cartons: [] }; return row }),
      },
    }
    const log = { log: jest.fn(async (data, client) => { expect(client).toBe(tx); receipt = data }) }
    const service = new ReturnsService({ customer: tx.customer, $transaction: (work: any) => work(tx) } as any, log as any, null as any, null as any, null as any, null as any)
    jest.spyOn(service as any, 'mapReturnForOms').mockImplementation((value: any) => value)
    jest.spyOn(service as any, 'pushReturnStatusToOms').mockResolvedValue(true)
    const body = { customerCode: 'TKL', returnNo: 'RT-ONE', orderNo: 'ORDER', returnReason: '退货', returnWarehouse: 'JHB3', requestedProcess: 'restock', items: [{ sku: 'A', quantity: 1 }] }
    expect((await service.createFromOms(body)).idempotent).toBe(false)
    expect(receipt.detail.requestFingerprint).toMatch(/^[a-f0-9]{64}$/)
    row.status = 'received'
    row.remark = '仓库操作备注'
    expect((await service.createFromOms(body)).idempotent).toBe(true)
    for (const changed of [{ ...body, orderNo: 'OTHER' }, { ...body, items: [{ sku: 'A', quantity: 2 }] }, { ...body, attachments: [{ fileName: 'new.png', contentBase64: 'aGVsbG8=' }] }]) {
      await expect(service.createFromOms(changed)).rejects.toThrow('退件单号已用于不同内容')
    }
    expect(log.log).toHaveBeenCalledTimes(1)
    expect(tx.returnOrder.create).toHaveBeenCalledTimes(1)
    expect(row.status).toBe('received')
  })
})
