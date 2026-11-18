import { BadRequestException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { getPagination } from '../../common/dto/pagination.dto'
import { readCatalogRefunds } from '../billing/catalog-refund-ledger.util'
import type { CatalogPurchaseQueryDto } from './dto/catalog-purchase-query.dto'
const skuKeys = (sku: string) => {
  const base = /^TKL-/i.test(sku) ? sku.slice(4) : sku
  return [...new Set([sku,base,`TKL-${base}`].filter(s=>s && s.length<=30))]
}
function dateStart(value: string) {
  const d=new Date(`${value}T00:00:00+08:00`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(d.getTime()) || new Date(d.getTime()+8*3600000).toISOString().slice(0,10)!==value) throw new BadRequestException('请选择有效的采购日期')
  return d
}
/** Historical quantities/prices come from paid orders; verified refunds remain visible after holding reaches zero. */
export async function readCatalogPurchases(prisma: any,q: CatalogPurchaseQueryDto) {
  const {page,pageSize}=getPagination(q,20)
  const start=q.startDate?dateStart(q.startDate):undefined, end=q.endDate?dateStart(q.endDate):undefined
  if(start && end && start>end) throw new BadRequestException('开始日期不能晚于结束日期')
  return prisma.$transaction(async (db:any)=>{
    const and:any[]=[], sku=q.sku?.trim(), code=q.customerCode?.trim(), customerKeyword=q.customerKeyword?.trim(), productKeyword=q.productKeyword?.trim()
    if(sku)and.push({sku:{in:skuKeys(sku)}})
    for(const filter of [{value:code,exact:true},{value:customerKeyword,exact:false}]) {
      if(!filter.value)continue
      const condition=filter.exact?{customerCode:filter.value}:{OR:[{customerCode:{contains:filter.value}},{customerName:{contains:filter.value}}]}
      const matched=await db.customer.findMany({where:condition,select:{id:true}})
      and.push({OR:[{customerCode:filter.exact?filter.value:{contains:filter.value}},{customerId:{in:matched.map((c:any)=>c.id)}}]})
    }
    if(productKeyword) {
      const products=await db.productPricing.findMany({where:{OR:[{sku:{contains:productKeyword}},{productName:{contains:productKeyword}}]},select:{id:true,sku:true}})
      and.push({OR:[{sku:{contains:productKeyword}},{sku:{in:[...new Set(products.flatMap((p:any)=>skuKeys(p.sku)))]}},{pricingId:{in:products.map((p:any)=>p.id)}}]})
    }
    if(q.orderNo?.trim())and.push({orderNo:{contains:q.orderNo.trim()}})
    if(q.status)and.push({status:q.status})
    if(start || end)and.push({createdAt:{...(start?{gte:start}:{}),...(end?{lt:new Date(end.getTime()+86400000)}:{})}})
    const where=and.length?{AND:and}:{}
    const [orders,total,sums]=await Promise.all([
      db.omsCatalogOrder.findMany({where,skip:(page-1)*pageSize,take:pageSize,orderBy:[{createdAt:'desc'},{id:'desc'}]}),
      db.omsCatalogOrder.count({where}),db.omsCatalogOrder.aggregate({where,_sum:{quantity:true,totalAmount:true}}),
    ])
    const ids=[...new Set(orders.map((o:any)=>o.customerId))]
    const customers=ids.length?await db.customer.findMany({where:{id:{in:ids}}}):[]
    const customerMap=new Map(customers.map((c:any)=>[String(c.id),c]))
    const products=orders.length?await db.productPricing.findMany({where:{OR:[{id:{in:orders.filter((o:any)=>o.pricingId!=null).map((o:any)=>o.pricingId)}},{sku:{in:[...new Set(orders.flatMap((o:any)=>skuKeys(o.sku)))]}}]},select:{id:true,sku:true,productName:true}}):[]
    const refunds=new Map<string,any[]|null>(),warnings:string[]=[]
    for(const c of customers) {
      try { refunds.set(String(c.id),await readCatalogRefunds(db,c)) }
      catch(e) { if(!(e instanceof BadRequestException))throw e;refunds.set(String(c.id),null);warnings.push(`客户${c.customerCode}的历史退款依据待核对；原采购记录仍可查看，退回及净额暂不计算。`) }
    }
    const items=orders.map((o:any)=>{
      const customer:any=customerMap.get(String(o.customerId)), ledger=refunds.get(String(o.customerId)), verified=ledger!==undefined && ledger!==null
      const lines=verified?ledger!.flatMap(r=>r.allocations.filter((a:any)=>a.orderId===Number(o.id)).map((a:any)=>({referenceNo:r.referenceNo,quantity:a.quantity,amount:a.amountCents/100,createdAt:r.createdAt}))):[]
      const returned=lines.reduce((n:number,r:any)=>n+r.quantity,0), amount=lines.reduce((n:number,r:any)=>n+Math.round(r.amount*100),0)/100
      const matches=products.filter((p:any)=>skuKeys(o.sku).some(s=>s.toLowerCase()===p.sku.toLowerCase()))
      const product=products.find((p:any)=>o.pricingId!=null && p.id===o.pricingId) || matches.find((p:any)=>p.sku===o.sku) || (matches.length===1?matches[0]:null)
      return {
        id:Number(o.id),orderNo:o.orderNo,sku:o.sku,productName:product?.productName||'',
        customerCode:o.customerCode||customer?.customerCode||'',customerName:customer?.customerName||'',
        quantity:o.quantity,unitPrice:o.unitPrice==null?null:Number(o.unitPrice),totalAmount:o.totalAmount==null?null:Number(o.totalAmount),
        priceTier:o.priceTier||'A',balanceBefore:o.balanceBefore==null?null:Number(o.balanceBefore),balanceAfter:o.balanceAfter==null?null:Number(o.balanceAfter),
        status:o.status,createdAt:o.createdAt,refundVerified:verified,refundedQuantity:verified?returned:null,refundAmount:verified?amount:null,
        netQuantity:verified?o.quantity-returned:null,
        netAmount:verified&&o.totalAmount!=null?(Math.round(Number(o.totalAmount)*100)-Math.round(amount*100))/100:null,
        refunds:lines,
      }

    })
    return {items,total,page,pageSize,summary:{quantity:Number(sums._sum.quantity??0),totalAmount:Number(sums._sum.totalAmount??0)},warnings}
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000})
}
