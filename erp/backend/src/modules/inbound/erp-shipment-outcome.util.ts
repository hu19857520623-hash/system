import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'

/** Read the operator's original create record without replaying a stock mutation. */
export async function readErpShipmentOutcome(db:any,requestId:string,actor:number) {
 if(!Number.isSafeInteger(actor)||actor<=0)throw new ForbiddenException('请使用原账号核对发运结果')
 if(typeof requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))throw new BadRequestException('原发运请求编号无效，请返回原页面核对')
 const previous=await db.operationLog.findFirst({where:{operatorId:BigInt(actor),module:'inbound',action:'create',targetType:'inbound_order',detail:{path:'$.clientRequestId',equals:requestId}},orderBy:{id:'asc'}})
 if(!previous)return {requestId,status:'unknown'}
 const id=Number(previous.detail?.inboundId),inboundNo=previous.targetId
 if(!Number.isSafeInteger(id)||id<=0||typeof inboundNo!=='string'||!inboundNo)throw new ConflictException('原发运关联信息不完整，请联系管理员核对，勿重新提交')
 const order=await db.inboundOrder.findUnique({where:{id:BigInt(id)},select:{id:true,inboundNo:true,status:true}})
 if(order && order.inboundNo!==inboundNo)throw new ConflictException('原发运单身份已变化，请联系管理员核对，勿重新提交')
 return {requestId,status:order?'confirmed':'deleted',inboundId:id,inboundNo,orderStatus:order?.status||null}
}
