import { OutboundService } from './outbound.service'

function fixture() {
  let rows: any[] = [{ id: 63n, outboundNo: 'OB-63', status: 'pending_pick', pickerId: null }, { id: 64n, outboundNo: 'OB-64', status: 'pending_pick', pickerId: null }], logs: any[] = [], tail = Promise.resolve()
  const tx: any = { $queryRaw: jest.fn().mockResolvedValue([]), sysUser: { findUnique: jest.fn(async () => ({ roleCode: 'outbound_clerk', status: 1, realName: '测试人员', username: 'test' })) }, sysUserPermission: { findMany: jest.fn(async () => [{ permCode: 'outbound.pick' }]) },
    outboundOrder: { findMany: jest.fn(async () => structuredClone(rows)), updateMany: jest.fn(async ({ data }: any) => { rows.forEach(r => Object.assign(r, data));return { count: rows.length } }) },
    operationLog: { findFirst: jest.fn(async ({ where }: any) => logs.find(r => where.action.in.includes(r.action) && r.detail.clientRequestId === where.detail.equals)), create: jest.fn(async ({ data }: any) => { logs.push(data);return data }) } }
  const db: any = { ...tx, $transaction: (work: any) => { const result = tail.then(async () => { const previous = structuredClone({ rows, logs });try { return await work(tx) } catch (e) { rows = previous.rows;logs = previous.logs;throw e } });tail = result.catch(() => {});return result } }
  const service = new OutboundService(db, {} as any, {} as any, {} as any, {} as any, {} as any)
  const original = { clientRequestId: 'original-assignment', expectedOrders: rows.map(r => ({ id: Number(r.id), status: r.status, pickerId: null })) }
  return { service, tx, original, get rows() { return rows }, get logs() { return logs } }
}
describe('原批量分配回执', () => {
  it('并发重放只分配一次，后续改派后旧重试只返回当前结果', async () => {
    const f = fixture(), results = await Promise.all([f.service.assignPicker([63,64],59,f.original,59),f.service.assignPicker([64,63],59,f.original,59)])
    expect(results.filter(r => (r as any).duplicate)).toHaveLength(1);expect(f.tx.outboundOrder.updateMany).toHaveBeenCalledTimes(1);expect(f.logs).toHaveLength(1)
    f.rows.forEach(r => { r.pickerId = 55n;r.status = 'shipped' })
    await expect(f.service.assignPicker([63,64],59,f.original,59)).resolves.toMatchObject({ outcome:'confirmed',duplicate:true,orders:[{status:'shipped',pickerId:55},{status:'shipped',pickerId:55}] })
    expect(f.tx.outboundOrder.updateMany).toHaveBeenCalledTimes(1)
  })
  it('取消先完成后迟到分配被阻止；完成后取消不撤回', async () => {
    const f=fixture();await expect(f.service.cancelAssignment([63,64],59,f.original,59)).resolves.toMatchObject({outcome:'cancelled'})
    await expect(f.service.assignPicker([63,64],59,f.original,59)).rejects.toThrow('已取消');expect(f.rows[0].status).toBe('pending_pick')
    const next={...f.original,clientRequestId:'next-original'};await f.service.assignPicker([63,64],59,next,59)
    await expect(f.service.cancelAssignment([63,64],59,next,59)).resolves.toMatchObject({outcome:'confirmed'})
    expect(f.rows[0].status).toBe('picking')
  })
  it('跨账号查询或重放拒绝，批次或人员改变不能复用编号', async () => {
    const f=fixture();await f.service.assignPicker([63,64],59,f.original,59)
    await expect(f.service.assignmentRequest(f.original.clientRequestId,51)).rejects.toThrow('其它账号')
    await expect(f.service.assignPicker([63,64],59,f.original,51)).rejects.toThrow('其它账号')
    await expect(f.service.assignPicker([63,64],55,f.original,59)).rejects.toThrow('不能更改')
    await expect(f.service.assignPicker([63],59,{...f.original,expectedOrders:[f.original.expectedOrders[0]]},59)).rejects.toThrow('不能更改')
    expect(f.tx.outboundOrder.updateMany).toHaveBeenCalledTimes(1)
  })
  it('原状态或拣货员变化时不写入，可以取消未完成原请求', async () => {
    const f=fixture();f.rows[0].status='picking';f.rows[0].pickerId=55n
    await expect(f.service.assignPicker([63,64],59,f.original,59)).rejects.toThrow('状态或拣货员已变化')
    expect(f.tx.outboundOrder.updateMany).not.toHaveBeenCalled()
    await expect(f.service.assignmentRequest(f.original.clientRequestId,59)).resolves.toMatchObject({outcome:'unknown'})
    await expect(f.service.cancelAssignment([63,64],59,f.original,59)).resolves.toMatchObject({outcome:'cancelled'})
    expect(f.rows[0].pickerId).toBe(55n)
  })
  it('回执写入失败整批分配回滚', async () => {
    const f=fixture();f.tx.operationLog.create.mockRejectedValueOnce(new Error('回执暂不可保存'))
    await expect(f.service.assignPicker([63,64],59,f.original,59)).rejects.toThrow('回执暂不可保存')
    expect(f.rows.every(r=>r.status==='pending_pick'&&r.pickerId===null)).toBe(true);expect(f.logs).toEqual([])
  })
  it('未持有完整原批次状态不能创建回执',async()=>{
    const f=fixture();await expect(f.service.assignPicker([63,64],59,{...f.original,expectedOrders:[]},59)).rejects.toThrow('原分配资料无效')
    expect(f.tx.$queryRaw).not.toHaveBeenCalled()
  })
})
