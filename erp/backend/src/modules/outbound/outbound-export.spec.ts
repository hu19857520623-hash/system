import { OutboundService } from './outbound.service'
import { Prisma } from '@prisma/client'

function fixture(count: number) {
  const rows = Array.from({ length: count }, (_, i) => ({ id: BigInt(count - i), outboundNo: `AUDIT-EXPORT-${count - i}`, status: 'shipped', createdAt: '2026-11-02 12:00:00' }))
  const findMany = jest.fn(async (query: any) => {
    const cursor = query.where.AND?.[1]?.id.lt
    return rows.filter(row => cursor == null || row.id < cursor).slice(0, query.take)
  })
  const tx = { outboundOrder: { findMany } }, prisma = { ...tx, $transaction: jest.fn(async (run: any) => run(tx)) }
  const service = Object.create(OutboundService.prototype) as OutboundService
  const where = { customerId: 263n, status: 'shipped', warehouseCode: 'WMS-JHB-01' }
  const enrich = jest.fn(async (batch: any[], db?: unknown) => { void db; return batch })
  Object.assign(service, { prisma, enrichOrders: enrich, buildListWhere: jest.fn().mockReturnValue(where) })
  return { service, rows, tx, prisma, where, findMany, enrich }
}

describe('出库文件导出完整筛选范围', () => {
  it('5101张匹配单据全部导出，最早一张不被5000上限截掉', async () => {
    const f = fixture(5101)
    const csv = await f.service.exportList({ page: 7, pageSize: 20, customerId: '263', status: 'shipped' })
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.split('\n')).toHaveLength(5102)
    expect(csv.split('\n')[1]).toMatch(/^AUDIT-EXPORT-5101,/)
    expect(csv.split('\n').at(-1)).toMatch(/^AUDIT-EXPORT-1,/)
    expect(f.findMany).toHaveBeenCalledTimes(11)
    expect(f.findMany.mock.calls[0][0].where).toEqual(f.where)
    expect(f.findMany.mock.calls[1][0].where).toEqual({ AND: [f.where, { id: { lt: 4602n } }] })
    expect(f.enrich.mock.calls.every(call => call[1] === f.tx)).toBe(true)
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 })
  })
  it('后续批次失败时导出失败，不返回部分CSV文件', async () => {
    const f = fixture(501)
    f.findMany.mockResolvedValueOnce(f.rows.slice(0, 500)).mockRejectedValueOnce(new Error('后续页读取失败'))
    await expect(f.service.exportList({})).rejects.toThrow('后续页读取失败')
  })
  it('没有匹配单据时仍返回中文表头', async () => {
    const f = fixture(0)
    const csv = await f.service.exportList({})
    expect(csv).toContain('出库单号,客户,仓库');expect(csv.split('\n')).toHaveLength(1)
  })
})
