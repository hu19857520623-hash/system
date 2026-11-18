import { BadRequestException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { getPagination } from '../../common/dto/pagination.dto'
import type { RechargeRecordQueryDto } from './dto/recharge-record-query.dto'
function dateStart(s:string){const d=new Date(`${s}T00:00:00+08:00`);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(d.getTime())||new Date(d.getTime()+28800000).toISOString().slice(0,10)!==s)throw new BadRequestException('请选择有效的充值日期');return d}
/** One row is one original recharge; no customer wallet aggregation or write operations. */
export async function readRechargeRecords(prisma:any,q:RechargeRecordQueryDto){
  const {page,pageSize}=getPagination(q),start=q.startDate?dateStart(q.startDate):undefined,end=q.endDate?dateStart(q.endDate):undefined
  if(start&&end&&start>end)throw new BadRequestException('开始日期不能晚于结束日期')
  for(const n of [q.minAmount,q.maxAmount])if(n!=null&&(!Number.isFinite(n)||n<0||n>999999999999.99||Math.abs(Math.round(n*100)-n*100)>0.001))throw new BadRequestException('金额范围须为非负金额且最多两位小数')
  if(q.minAmount!=null&&q.maxAmount!=null&&q.minAmount>q.maxAmount)throw new BadRequestException('最低金额不能大于最高金额')
  return prisma.$transaction(async(db:any)=>{
    const and:any[]=[]
    if(q.customerId!=null)and.push({customerId:BigInt(q.customerId)})
    if(q.customerKeyword?.trim()){
      const text=q.customerKeyword.trim(),customers=await db.customer.findMany({where:{OR:[{customerCode:{contains:text}},{customerName:{contains:text}}]},select:{id:true}})
      and.push({customerId:{in:customers.map((r:any)=>r.id)}})
    }
    if(q.keyword?.trim()){
      const text=q.keyword.trim(),customers=await db.customer.findMany({where:{OR:[{customerCode:{contains:text}},{customerName:{contains:text}}]},select:{id:true}})
      and.push({OR:[{rechargeNo:{contains:text}},{remark:{contains:text}},{customerId:{in:customers.map((r:any)=>r.id)}}]})
    }
    if(q.rechargeNo?.trim())and.push({rechargeNo:{contains:q.rechargeNo.trim()}})
    if(q.paymentMethod?.trim())and.push({paymentMethod:q.paymentMethod.trim()})
    if(q.status)and.push({status:q.status})
    if(start||end)and.push({createdAt:{...(start?{gte:start}:{}),...(end?{lt:new Date(end.getTime()+86400000)}:{})}})
    if(q.minAmount!=null||q.maxAmount!=null)and.push({amount:{...(q.minAmount!=null?{gte:q.minAmount}:{}),...(q.maxAmount!=null?{lte:q.maxAmount}:{})}})
    const where=and.length?{AND:and}:{}
    const [records,total,amounts,confirmed,methods]=await Promise.all([
      db.customerRecharge.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*pageSize,take:pageSize}),
      db.customerRecharge.count({where}),db.customerRecharge.aggregate({where,_sum:{amount:true}}),
      db.customerRecharge.aggregate({where:{AND:[where,{status:'confirmed'}]},_sum:{amount:true}}),
      db.customerRecharge.groupBy({by:['paymentMethod'],orderBy:{paymentMethod:'asc'}}),
    ])
    const customerIds=[...new Set(records.map((r:any)=>r.customerId))],operatorIds=[...new Set(records.filter((r:any)=>r.operatorId!=null).map((r:any)=>r.operatorId))]
    const [customers,operators]=await Promise.all([
      customerIds.length?db.customer.findMany({where:{id:{in:customerIds}},select:{id:true,customerCode:true,customerName:true}}):[],
      operatorIds.length?db.sysUser.findMany({where:{id:{in:operatorIds}},select:{id:true,realName:true}}):[],
    ])
    const cm=new Map(customers.map((r:any)=>[String(r.id),r])),om=new Map(operators.map((r:any)=>[String(r.id),r.realName]))
    return {items:records.map((r:any)=>{
      const c:any=cm.get(String(r.customerId))
      return {id:Number(r.id),rechargeNo:r.rechargeNo,customerId:Number(r.customerId),customerCode:c?.customerCode||'',customerName:c?.customerName||'',amount:Number(r.amount),paymentMethod:r.paymentMethod,status:r.status,remark:r.remark||'',operatorName:r.operatorId==null?'系统/未记录':om.get(String(r.operatorId))||`历史账号(${r.operatorId})`,createdAt:r.createdAt}
    }),total,page,pageSize,summary:{amount:Number(amounts._sum.amount??0),confirmedAmount:Number(confirmed._sum.amount??0)},paymentMethods:methods.map((r:any)=>r.paymentMethod)}
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:30000})
}
