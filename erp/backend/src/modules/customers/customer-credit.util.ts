import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { billingCents } from '../billing/billing-workflow.util'
import { customerCredit } from '../../common/customer-credit.util'

export async function setCustomerCredit(prisma: any, id: number, data: any, actor: number) {
  for (const key of ['creditLimit', 'expectedCreditLimit']) {
    if (typeof data?.[key] !== 'number' || !Number.isFinite(data[key]) || data[key] < 0) throw new BadRequestException('信用额度须为非负金额，最多两位小数')
    billingCents(data[key])
  }
  const remark = typeof data.remark === 'string' ? data.remark.trim() : ''
  if (!remark || remark.length > 500) throw new BadRequestException('请填写调整原因，最多500字')
  return prisma.$transaction(async (tx: any) => {
    await tx.$queryRaw`SELECT id FROM customer WHERE id = ${BigInt(id)} FOR UPDATE`
    const customer = await tx.customer.findUnique({ where: { id: BigInt(id) } })
    if (!customer) throw new NotFoundException('客户不存在')
    const previous = Number(customer.creditLimit ?? 0)
    if (previous !== data.expectedCreditLimit) throw new ConflictException('信用额度已变化，请刷新客户后重新调整')
    if (billingCents(data.creditLimit) < Math.max(0, -billingCents(customer.balance))) throw new BadRequestException('信用额度不能低于当前欠款，请先充值归还欠款')
    const updated = await tx.customer.update({ where: { id: customer.id }, data: { creditLimit: data.creditLimit } })
    await tx.operationLog.create({ data: { module: 'customers', action: 'credit_limit', operatorId: BigInt(actor), targetType: 'customer', targetId: String(id), detail: { customerCode: customer.customerCode, before: previous, after: data.creditLimit, balance: Number(customer.balance), remark } } })
    return { customerCode: customer.customerCode, balance: Number(updated.balance), ...customerCredit(updated) }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000 })
}
