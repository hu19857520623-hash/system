import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { billingCents } from '../billing/billing-workflow.util'

/** The immutable recharge number is the receipt and retry key for both portals. */
export async function creditCustomer(prisma: any, id: number, data: any, operatorId?: number) {
  if (typeof data?.amount !== 'number' || !Number.isFinite(data.amount)) throw new BadRequestException('请输入有效充值金额，最多两位小数')
  const cents = billingCents(data.amount)
  if (cents <= 0) throw new BadRequestException('充值金额须大于 0')
  const rechargeNo = typeof data.rechargeNo === 'string' ? data.rechargeNo.trim() : ''
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(rechargeNo)) throw new BadRequestException('请提供原充值单号，最多30位字母、数字、下划线或短横线')
  if (data.remark != null && typeof data.remark !== 'string') throw new BadRequestException('充值备注无效，请重新核对')
  const paymentMethod = data.paymentMethod || 'bank', remark = data.remark?.trim() || null
  if (typeof paymentMethod !== 'string' || paymentMethod.length > 20 || (remark && (typeof remark !== 'string' || remark.length > 500))) throw new BadRequestException('充值方式或备注无效，请重新核对')
  try {
    return await prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT id FROM customer WHERE id = ${BigInt(id)} FOR UPDATE`
      const customer = await tx.customer.findUnique({ where: { id: BigInt(id) } })
      if (!customer) throw new NotFoundException('客户不存在，请重新选择')
      let record = await tx.customerRecharge.findUnique({ where: { rechargeNo } })
      const duplicate = !!record
      if (record) {
        if (record.customerId !== BigInt(id) || billingCents(record.amount) !== cents || record.paymentMethod !== paymentMethod || (record.remark || null) !== remark || record.status !== 'confirmed') throw new ConflictException('原充值单号对应的客户、金额、方式或备注不同，请核对原充值记录，勿另建单重复充值')
      } else {
        if (billingCents(customer.balance) + cents > 99999999999999) throw new BadRequestException('充值后余额超出支持范围，请核对金额')
        record = await tx.customerRecharge.create({ data: { rechargeNo, customerId: BigInt(id), amount: (cents / 100).toFixed(2), paymentMethod, remark, status: 'confirmed', operatorId: operatorId ? BigInt(operatorId) : undefined } })
        await tx.customer.update({ where: { id: BigInt(id) }, data: { balance: { increment: (cents / 100).toFixed(2) } } })
      }
      const latest = await tx.customer.findUnique({ where: { id: BigInt(id) } })
      return { record: { id: Number(record.id), customerId: id, rechargeNo, amount: Number(record.amount), paymentMethod: record.paymentMethod, status: record.status, remark: record.remark, createdAt: record.createdAt }, balance: Number(latest.balance), customerCode: customer.customerCode, duplicate }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000 })
  } catch (error) {
    if ((error as any)?.code === 'P2002') throw new ConflictException('充值单号已被使用，请使用原客户与原单核对，勿重复充值')
    throw error
  }
}
