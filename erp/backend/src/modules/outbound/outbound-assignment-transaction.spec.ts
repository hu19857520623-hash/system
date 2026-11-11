import { OutboundService } from './outbound.service'

function fixture() {
  let rows: any[] = [{ id: 63n, outboundNo: 'OB-63', status: 'pending_pick', pickerId: null }, { id: 64n, outboundNo: 'OB-64', status: 'pending_pick', pickerId: null }]
  let tail = Promise.resolve()
  const tx: any = { $queryRaw: jest.fn().mockResolvedValue([]), sysUser: { findUnique: jest.fn(async () => ({ id: 59n, roleCode: 'outbound_clerk', status: 1, username: 'picker' })) },
    sysUserPermission: { findMany: jest.fn(async () => [{ permCode: 'outbound.pick' }]) },
    outboundOrder: { findMany: jest.fn(async () => structuredClone(rows)), updateMany: jest.fn(async ({ data }: any) => { rows.forEach(r => Object.assign(r, data));return { count: rows.length } }) } }
  const db: any = { ...tx, $transaction: (work: any) => { const result = tail.then(async () => { const before = structuredClone(rows);try { return await work(tx) } catch (e) { rows = before;throw e } });tail = result.catch(() => {});return result } }
  const service = new OutboundService(db, {} as any, {} as any, {} as any, {} as any, {} as any)
  return { service, tx, get rows() { return rows } }
}
describe('批量分配事务', () => {
  it('更新条数不足时整批回滚，不能失败后留下一部分已分配', async () => {
    const f = fixture(), before = structuredClone(f.rows)
    f.tx.outboundOrder.updateMany.mockImplementationOnce(async ({ data }: any) => { Object.assign(f.rows[0], data);return { count: 1 } })
    await expect(f.service.assignPicker([63, 64], 59)).rejects.toThrow('状态已变化')
    expect(f.rows).toEqual(before)
  })
  it('重叠分配按固定顺序锁单，第二次不会重置首次拣货时间', async () => {
    const f = fixture()
    await Promise.all([f.service.assignPicker([64, 63], 59), f.service.assignPicker([63, 64], 59)])
    expect(f.tx.$queryRaw.mock.calls.map((call: any[]) => call[1])).toEqual([59n, 63n, 64n, 59n, 63n, 64n])
    const calls = f.tx.outboundOrder.updateMany.mock.calls
    expect(calls[0][0].data.pickingStartedAt).toBeInstanceOf(Date)
    expect(calls[1][0].data).not.toHaveProperty('pickingStartedAt')
  })
  it('批次含取消或已拣货单时全部不更新', async () => {
    const f = fixture();f.rows[1].status = 'cancelled'
    await expect(f.service.assignPicker([63, 64], 59)).rejects.toThrow('仅待拣货或拣货中状态')
    expect(f.tx.outboundOrder.updateMany).not.toHaveBeenCalled();expect(f.rows[0].status).toBe('pending_pick')
  })
  it.each([[[63, 63]], [[0, 64]], [[1.5, 64]]])('非法或重复批次不进入事务 %p', async ids => {
    const f = fixture();await expect(f.service.assignPicker(ids, 59)).rejects.toThrow('有效且不重复')
    expect(f.tx.$queryRaw).not.toHaveBeenCalled()
  })
})
