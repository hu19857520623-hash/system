import { CatalogNegativeService } from './catalog-negative.service'
import { reclaimCatalog, assertRefundAuthority } from '../inventory/catalog-reclaim.util'
import { readCatalogRefunds, paidCatalogPurchase } from '../billing/catalog-refund-ledger.util'
jest.mock('../inventory/catalog-reclaim.util', () => ({ reclaimCatalog: jest.fn(), assertRefundAuthority: jest.fn() }))
jest.mock('../billing/catalog-refund-ledger.util', () => ({ readCatalogRefunds: jest.fn(), paidCatalogPurchase: jest.fn() }))
const input = { requestId: '97102566-c888-47eb-9eab-0ecdf141f941', customerCode: 'C1', orderNo: 'P1', quantity: 2, reason: '退回清账' }
function fixture() {
  let rows: any[] = [], credits = 0, failUpdate = false
  const order: any = { id: 9n, customerId: 1n, orderNo: 'P1', sku: 'TKL-A', quantity: 10, unitPrice: 10 }
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    customer: { findUnique: jest.fn().mockResolvedValue({ id: 1n, customerCode: 'C1', status: 1 }) },
    omsCatalogOrder: { findUnique: jest.fn().mockImplementation(async () => order) },
    billingCharge: { findMany: jest.fn().mockResolvedValue([]) },
    customerSkuInventory: { findMany: jest.fn().mockResolvedValue([{ quantity: 10 }]) },
    operationLog: {
      findFirst: jest.fn().mockImplementation(async ({where}: any) => rows.find(r => where.id ? r.id === where.id : r.targetId === where.targetId) ?? null),
      findUnique: jest.fn().mockImplementation(async ({where}: any) => rows.find(r => r.id === where.id)),
      findMany: jest.fn().mockImplementation(async () => rows.filter(r => r.action === 'pending')),
      create: jest.fn().mockImplementation(async ({data}: any) => { const r = { id: BigInt(rows.length+1), ...data };rows.push(r);return r }),
      update: jest.fn().mockImplementation(async ({where,data}: any) => { if(failUpdate) throw Error('audit failed');const r=rows.find(r => r.id===where.id);Object.assign(r,data);return r }),
    },
  }
  const db: any = { $transaction: async (fn: any) => {
    const oldRows=structuredClone(rows), oldCredits=credits
    try { return await fn(tx) } catch(e) { rows=oldRows;credits=oldCredits;throw e }
  } }
  ;(reclaimCatalog as jest.Mock).mockImplementation(async (adapter, _data, _actor) => adapter.$transaction(async (inner: any) => { expect(inner).toBe(tx);credits++;return { referenceNo:'RCL-1' } }))
  return { service:new CatalogNegativeService(db), tx, order, rows:()=>rows, credits:()=>credits, fail:()=>{failUpdate=true} }
}
beforeEach(() => { jest.clearAllMocks();(assertRefundAuthority as jest.Mock).mockResolvedValue(undefined);(readCatalogRefunds as jest.Mock).mockResolvedValue([]);(paidCatalogPurchase as jest.Mock).mockReturnValue(true) })
describe('负申购申请与审核', () => {
  it('以原单价格生成负数量金额，申请不触发退款', async () => {
    const f=fixture();expect(await f.service.submit(input)).toMatchObject({quantity:-2,unitPrice:10,amount:-20,status:'pending',orderId:9})
    expect(reclaimCatalog).not.toHaveBeenCalled()
  })
  it('同一请求幂等，内容改变时拒绝覆盖', async () => {
    const f=fixture();await f.service.submit(input);await f.service.submit(input);expect(f.rows()).toHaveLength(1)
    await expect(f.service.submit({...input,quantity:3})).rejects.toThrow('内容不同')
  })
  it('不能对冲其他客户的原单', async () => {
    const f=fixture();f.order.customerId=2n;await expect(f.service.submit(input)).rejects.toThrow('原申购单不存在')
  })
  it('未付款或未审核的原单禁止退回', async () => {
    const f=fixture();(paidCatalogPurchase as jest.Mock).mockReturnValue(false);await expect(f.service.submit(input)).rejects.toThrow('付款依据完整')
  })
  it('已退款加待审核数量不得超出原单', async () => {
    const f=fixture();(readCatalogRefunds as jest.Mock).mockResolvedValue([{allocations:[{orderId:9,quantity:7}]}]);await f.service.submit(input)
    await expect(f.service.submit({...input,requestId:'a7102566-c888-47eb-9eab-0ecdf141f941'})).rejects.toThrow('当前可退回 1')
  })
  it('已出库或持有量不足时不允许申请', async () => {
    const f=fixture();f.tx.customerSkuInventory.findMany.mockResolvedValue([{quantity:1}]);await expect(f.service.submit(input)).rejects.toThrow('持有量不足')
  })
  it('审核复用原单价退款，并与审核状态同事务提交；重试不重复退款', async () => {
    const f=fixture();await f.service.submit(input);await f.service.decide(1,{decision:'approved'},7)
    expect(reclaimCatalog).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({quantity:2,expectedRefundAmount:20,allocations:[{orderId:9,quantity:2}]}),7)
    await f.service.decide(1,{decision:'approved'},7);expect(f.credits()).toBe(1);expect(f.rows()[0].action).toBe('approved')
  })
  it('驳回释放额度，不生成退款；已驳回的单不能再通过', async () => {
    const f=fixture();await f.service.submit(input);await f.service.decide(1,{decision:'rejected'},7);expect(f.credits()).toBe(0)
    await expect(f.service.decide(1,{decision:'approved'},7)).rejects.toThrow('已审核')
  })
  it('审核写入失败时退款一并回滚', async () => {
    const f=fixture();await f.service.submit(input);f.fail();await expect(f.service.decide(1,{decision:'approved'},7)).rejects.toThrow('audit failed');expect(f.credits()).toBe(0);expect(f.rows()[0].action).toBe('pending')
  })
  it('财务权限失效不能审核', async () => {
    const f=fixture();await f.service.submit(input);(assertRefundAuthority as jest.Mock).mockRejectedValueOnce(Error('无退款权限'))
    await expect(f.service.decide(1,{decision:'approved'},7)).rejects.toThrow('无退款权限');expect(f.credits()).toBe(0)
  })
  it('撤销仅限本人待审核申请，重复撤销幂等且释放额度', async () => {
    const f=fixture();await f.service.submit({...input,quantity:10})
    await expect(f.service.cancel(1,'C2')).rejects.toThrow('当前客户')
    await f.service.cancel(1,'C1');await f.service.cancel(1,'C1');expect(f.rows()[0].action).toBe('cancelled')
    await f.service.submit({...input,requestId:'a7102566-c888-47eb-9eab-0ecdf141f941',quantity:10});expect(f.credits()).toBe(0)
  })
  it('已通过申请不能撤销或重复冲账', async () => {
    const f=fixture();await f.service.submit(input);await f.service.decide(1,{decision:'approved'},7)
    await expect(f.service.cancel(1,'C1')).rejects.toThrow('已审核');expect(f.credits()).toBe(1)
  })
  it.each([0,-1,1.5,NaN])('非法数量 %p 不写入申请', async quantity => { const f=fixture();await expect(f.service.submit({...input,quantity})).rejects.toThrow('有效退回数量');expect(f.rows()).toHaveLength(0) })
})
