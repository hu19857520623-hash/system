import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PermissionsService } from '../../common/permissions/permissions.service'
import { withCatalogReceiptCaps } from './catalog-receipts.util'
import { catalogStockPool, remainingCatalogStock } from './catalog-stock.util'
import type { CatalogVisibilityDto } from './dto/catalog-visibility.dto'

/** An absolute, bounded setting. Repeating the same target never increments inventory or money. */
export async function setCatalogVisibility(prisma:any,id:number,body:CatalogVisibilityDto,actor?:number) {
  if(!Number.isSafeInteger(actor)||!actor||actor<=0)throw new ForbiddenException('请重新登录后调整货盘额度')
  if(!Number.isSafeInteger(id)||id<=0)throw new BadRequestException('请选择有效货盘记录')
  if(!Number.isSafeInteger(body?.visibleStockQty)||body.visibleStockQty<0||body.visibleStockQty>2147483647)throw new BadRequestException('总可见额度须为范围内的非负整数')
  if((body.expectedVisibleStockQty!==null&&(!Number.isSafeInteger(body.expectedVisibleStockQty)||body.expectedVisibleStockQty<0))||!Number.isSafeInteger(body.expectedReceivedGoodQty)||body.expectedReceivedGoodQty<0)throw new BadRequestException('请重新读取当前额度与累计良品实收后继续')
  return prisma.$transaction(async(tx:any)=>{
    await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(actor)} FOR UPDATE`
    const user=await tx.sysUser.findUnique({where:{id:BigInt(actor)},select:{status:true,roleCode:true,realName:true}})
    if(!user||user.status!==1||!await new PermissionsService(tx).userHasPerm(actor,user.roleCode,'pricing.set'))throw new ForbiddenException('当前账号无调整货盘额度权限，请重新登录后核对')
    await tx.$queryRaw`SELECT id FROM product_pricing WHERE id = ${BigInt(id)} FOR UPDATE`
    const raw=await tx.productPricing.findUnique({where:{id:BigInt(id)}})
    if(!raw)throw new NotFoundException('货盘记录不存在，请返回列表重新查询')
    if(!['priced','synced'].includes(raw.pricingStatus))throw new BadRequestException('请先在确认定价中填写额度；已定价或已同步商品可单独调整')
    const [row]=await withCatalogReceiptCaps(tx,[raw])
    if(row.receivedGoodQty!==body.expectedReceivedGoodQty)throw new ConflictException('累计良品实收已变化，请重新读取额度后继续')
    if(body.visibleStockQty>row.receivedGoodQty)throw new BadRequestException(`总可见额度最多为累计良品实收 ${row.receivedGoodQty} 件，在途与破损不计入`)
    const current=raw.visibleStockQty==null?null:Number(raw.visibleStockQty),duplicate=current===body.visibleStockQty
    if(!duplicate&&current!==body.expectedVisibleStockQty)throw new ConflictException('总可见额度已被其它操作修改，请重新读取后核对')
    const next={...row,visibleStockQty:body.visibleStockQty}
    if(!duplicate){
      await tx.productPricing.update({where:{id:raw.id},data:{visibleStockQty:body.visibleStockQty,...(remainingCatalogStock(next)<=0?{orderableOnOms:false}:{})}})
      await tx.productPricingHistory.create({data:{pricingId:raw.id,operatorRole:user.realName||'额度操作员',action:'调整可见额度',detail:`总可见额度 ${current??'未设置'} → ${body.visibleStockQty} 件；累计良品实收 ${row.receivedGoodQty} 件，已售 ${raw.soldQty||0} 件；未增减仓内库存或客户余额`}})
    }
    return {id,sku:raw.sku,visibleStockQty:body.visibleStockQty,receivedGoodQty:row.receivedGoodQty,soldQty:raw.soldQty||0,catalogStockPool:catalogStockPool(next),remainingStockQty:remainingCatalogStock(next),duplicate}
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,timeout:30000})
}
