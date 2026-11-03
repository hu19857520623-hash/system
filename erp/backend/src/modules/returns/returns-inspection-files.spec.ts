import { ReturnsService } from './returns.service'

describe('inspection upload rollback', () => {
  it('uses unique paths for same named files and removes only newly written files after audit failure', async () => {
    const files = {
      write: jest.fn((sub, name) => ({ relativePath: sub + '/' + name })),
      remove: jest.fn(),
    }
    const tx = {
      $queryRaw: jest.fn(),
      returnOrder: {
        findUnique: jest.fn().mockResolvedValue({ id: 1n, returnNo: 'RT-ONE', status: 'fee_calculated' }),
        update: jest.fn().mockResolvedValue({ returnNo: 'RT-ONE' }),
      },
      returnAttachment: { create: jest.fn() },
    }
    const log = { log: jest.fn(async (_data, client) => { expect(client).toBe(tx); throw Error('审计暂不可用') }) }
    const service = new ReturnsService({ $transaction: (work: any) => work(tx) } as any, log as any, files as any, null as any, null as any, null as any)
    const notify = jest.spyOn(service as any, 'pushReturnStatusToOms').mockResolvedValue(true)
    const photo = { fileName: 'photo.png', contentBase64: 'aGVsbG8=' }
    await expect(service.submitInspection(1, { inspectionResult: 'good', attachments: [photo, photo] }, 1)).rejects.toThrow('审计暂不可用')
    const paths = files.write.mock.results.map(row => row.value.relativePath)
    expect(new Set(paths).size).toBe(2)
    expect(files.remove.mock.calls.map(row => row[0])).toEqual(paths)
    expect(notify).not.toHaveBeenCalled()
  })
})
