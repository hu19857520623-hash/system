import { CatalogNegativeService } from './catalog-negative.service'
import { notifyOms } from '../../common/oms-notify.util'
import { pushCatalogStockToOms } from './oms-catalog-sync.util'
import { billingSourceSnapshot } from '../billing/billing-snapshot.util'
jest.mock('../../common/oms-notify.util',()=>({notifyOms:jest.fn()}))
jest.mock('./oms-catalog-sync.util',()=>({pushCatalogStockToOms:jest.fn()}))
jest.mock('../billing/billing-snapshot.util',()=>({billingSourceSnapshot:jest.fn()}))
const approved={id:1,status:'approved',referenceNo:'RCL-1',customerCode:'C1',quantity:-5}
function fixture(){
 const receipt={referenceNo:'RCL-1',customerCode:'C1',sku:'A',quantity:5,remainingQty:4,balanceAfter:100}
 const prisma:any={$transaction:jest.fn().mockResolvedValue(approved),operationLog:{findFirst:jest.fn().mockResolvedValue({detail:{response:receipt}})},customer:{findUnique:jest.fn().mockResolvedValue({id:1n,customerCode:'C1',balance:120})}}
 return {prisma,receipt,service:new CatalogNegativeService(prisma)}
}
beforeEach(()=>{jest.resetAllMocks();(notifyOms as jest.Mock).mockResolvedValue(true);(pushCatalogStockToOms as jest.Mock).mockResolvedValue({});(billingSourceSnapshot as jest.Mock).mockResolvedValue({monthlyTotal:1,pendingTotal:0,refunds:[{referenceNo:'RCL-1',amount:545,allocations:[]}]})})
describe('负申购提交后的OMS同步',()=>{
 it('使用已提交回执推送库存，并使用最新余额而不是旧退款余额',async()=>{const f=fixture();expect(await f.service.decide(1,{decision:'approved'},7)).toMatchObject({status:'approved',syncPending:false});expect(notifyOms).toHaveBeenCalledWith('inventory.changed','C1',expect.objectContaining({quantity:5,remainingQty:4}));expect(notifyOms).toHaveBeenCalledWith('billing.changed','C1',expect.objectContaining({balance:120,refunds:[expect.objectContaining({amount:545})]}))})
 it('通知失败保留已入账状态，重试只重发通知',async()=>{const f=fixture();(notifyOms as jest.Mock).mockResolvedValueOnce(false);expect(await f.service.decide(1,{decision:'approved'},7)).toMatchObject({status:'approved',syncPending:true});expect(await f.service.decide(1,{decision:'approved'},7)).toMatchObject({status:'approved',syncPending:false});expect(f.prisma.$transaction).toHaveBeenCalledTimes(2)})
 it('回执不匹配不能推送错误退款数据',async()=>{const f=fixture();f.receipt.customerCode='C2';expect(await f.service.decide(1,{decision:'approved'},7)).toMatchObject({syncPending:true});expect(notifyOms).not.toHaveBeenCalled()})
 it('事务失败不推送成功消息',async()=>{const f=fixture();f.prisma.$transaction.mockRejectedValue(Error('rollback'));await expect(f.service.decide(1,{decision:'approved'},7)).rejects.toThrow('rollback');expect(notifyOms).not.toHaveBeenCalled()})
})
