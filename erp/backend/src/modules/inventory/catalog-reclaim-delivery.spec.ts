import { InventoryService } from './inventory.service'
import { reclaimCatalog } from './catalog-reclaim.util'
import { billingSourceSnapshot } from '../billing/billing-snapshot.util'
import { notifyOms } from '../../common/oms-notify.util'
import { pushCatalogStockToOms } from '../pricing/oms-catalog-sync.util'
jest.mock('./catalog-reclaim.util',()=>({reclaimCatalog:jest.fn()}))
jest.mock('../billing/billing-snapshot.util',()=>({billingSourceSnapshot:jest.fn()}))
jest.mock('../../common/oms-notify.util',()=>({notifyOms:jest.fn()}))
jest.mock('../pricing/oms-catalog-sync.util',()=>({pushCatalogStockToOms:jest.fn()}))
describe('收回退款提交后的通知恢复',()=>{
  beforeEach(()=>jest.resetAllMocks())
  it('已提交但持有通知失败返回待同步，原单重试只重发并使用最新余额',async()=>{
    const saved={sku:'TKL-A',customerCode:'TKL9001',quantity:1,remainingQty:3,refundAmount:1.25,balanceAfter:11.25,referenceNo:'RCL-'+'a'.repeat(32)}
    ;(reclaimCatalog as jest.Mock).mockResolvedValueOnce(saved).mockResolvedValueOnce({...saved,duplicate:true})
    ;(pushCatalogStockToOms as jest.Mock).mockResolvedValue({})
    ;(notifyOms as jest.Mock).mockResolvedValueOnce(false).mockResolvedValue(true)
    ;(billingSourceSnapshot as jest.Mock).mockResolvedValue({monthlyTotal:1.25,pendingTotal:0,refunds:[{referenceNo:saved.referenceNo,amount:1.25,allocations:[]}]})
    const service=new InventoryService({customer:{findUnique:async()=>({id:1n,balance:'12.50'})}} as any,{} as any,{} as any)
    const body:any={clientRequestId:'original',customerCode:'TKL9001',sku:'TKL-A',quantity:1}
    expect(await service.reclaimCatalogHolding(body,7)).toMatchObject({refundAmount:1.25,syncPending:true})
    expect(await service.reclaimCatalogHolding(body,7)).toMatchObject({duplicate:true,syncPending:false})
    expect((reclaimCatalog as jest.Mock).mock.calls[0]).toEqual((reclaimCatalog as jest.Mock).mock.calls[1])
    expect((notifyOms as jest.Mock).mock.calls.find(call=>call[0]==='billing.changed')?.[2]).toMatchObject({balance:12.5,monthlySpent:1.25,refunds:[{amount:1.25}]})
  })
  it('核心退款失败时不推送成功通知',async()=>{
    ;(reclaimCatalog as jest.Mock).mockRejectedValue(new Error('凭据不足'))
    const service=new InventoryService({} as any,{} as any,{} as any)
    await expect(service.reclaimCatalogHolding({} as any,7)).rejects.toThrow('凭据不足');expect(notifyOms).not.toHaveBeenCalled()
  })
})
