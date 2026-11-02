import { InboundService } from './inbound.service'

function fixture() {
  const files = { safeFileName: jest.fn(name => name), read: jest.fn(() => Buffer.from('原附件')), write: jest.fn(() => ({ relativePath: 'inbound-attachments/new.txt' })), remove: jest.fn() }
  const db: any = { $queryRawUnsafe: jest.fn(async () => []), $executeRawUnsafe: jest.fn(async () => 1) }
  const service = new InboundService(db, files as any, null as any, null as any, null as any, null as any)
  return { files, db, service: service as any }
}

describe('入库附件内容与失败清理', () => {
  it('附件同名且内容相同才能重放，文件缺失时给出中文恢复路径', async () => {
    const f = fixture()
    f.db.$queryRawUnsafe.mockResolvedValue([{ fileName: 'original.txt', filePath: 'saved.txt' }])
    const original = [{ fileName: 'original.txt', contentBase64: Buffer.from('原附件').toString('base64') }]
    await expect(f.service.checkOmsAsnAttachments(f.db, 1n, original)).resolves.toBeUndefined()
    for (const attachments of [[], [{ ...original[0], fileName: 'other.txt' }], [{ ...original[0], contentBase64: Buffer.from('更改').toString('base64') }]]) {
      await expect(f.service.checkOmsAsnAttachments(f.db, 1n, attachments)).rejects.toThrow('请返回原单通过修改入口核对附件')
    }
    f.files.read.mockImplementation(() => { throw Error('missing') })
    await expect(f.service.checkOmsAsnAttachments(f.db, 1n, original)).rejects.toThrow('无法读取')
  })

  it('数据库写入失败仍保留本次新文件清单以便回滚后清理', async () => {
    const f = fixture(), written: string[] = []
    f.db.$executeRawUnsafe.mockRejectedValue(Error('数据库失败'))
    await expect(f.service.saveOmsAsnAttachments(1n, [{ fileName: 'a.txt', contentBase64: 'YQ==' }], f.db, written)).rejects.toThrow('数据库失败')
    expect(written).toEqual([expect.stringMatching(/^inbound-attachments\/[0-9a-f-]+_a\.txt$/)])
    await f.service.cleanUnreferencedAsnFiles(written)
    expect(f.files.remove).toHaveBeenCalledWith(written[0])
  })

  it('提交回执丢失时保留已引用文件；无法确认数据库状态也保留文件', async () => {
    const f = fixture(), warning = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      f.db.$queryRawUnsafe.mockResolvedValue([{ id: 1n }])
      await f.service.cleanUnreferencedAsnFiles(['committed.txt'])
      f.db.$queryRawUnsafe.mockRejectedValue(Error('连接中断'))
      await f.service.cleanUnreferencedAsnFiles(['uncertain.txt'])
      expect(f.files.remove).not.toHaveBeenCalled()
    } finally { warning.mockRestore() }
  })
})
