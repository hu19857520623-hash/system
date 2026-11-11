export function validateShipmentOutcome(requestId:string,value:any){
 if(value?.requestId!==requestId || !['unknown','confirmed','deleted'].includes(value.status) || value.status!=='unknown'&&(!Number.isSafeInteger(value.inboundId)||value.inboundId<=0||typeof value.inboundNo!=='string'||!value.inboundNo))throw Error('原发运回执不完整，请保留原请求继续核对')
 return value as {requestId:string;status:'unknown'|'confirmed'|'deleted';inboundId?:number;inboundNo?:string;orderStatus?:string}
}
export function copyDeletedShipmentForm<T extends {inboundNo:string;attachments:any[];cartons:Array<{boxCode:string}>}>(original:T):T{
 const form=JSON.parse(JSON.stringify(original)) as T
 form.inboundNo='';form.attachments=[];if(!Array.isArray(form.cartons))form.cartons=[];form.cartons.forEach(c=>{c.boxCode=''})
 return form
}
