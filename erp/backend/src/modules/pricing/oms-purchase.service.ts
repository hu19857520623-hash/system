import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { catalogStockPool, remainingCatalogStock } from './catalog-stock.util'
import { pushCatalogStockToOms } from './oms-catalog-sync.util'

function num(v: unknown, fallback = 0): number {
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export type OmsPurchaseInput = {
  orderNo: string
  customerId?: number
  customerCode?: string
  sku: string
  quantity: number
  unitPrice?: number
}

@Injectable()
export class OmsPurchaseService {
  constructor(private prisma: PrismaService) {}

  private async nextChargeSuffix(tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0], customerId: bigint): Promise<string> {
    const rows: { charge_no: string }[] = await tx.$queryRawUnsafe(
      'SELECT charge_no FROM billing_charge WHERE customer_id = ? ORDER BY id DESC LIMIT 1',
      Number(customerId),
    )
    const last = String(rows[0]?.charge_no || '')
    const match = last.match(/CHG-(\d+)$/)
    const next = match ? Number(match[1]) + 1 : 1
    return `CHG-${String(next).padStart(3, '0')}`
  }

  private formatChargeNo(customerCode: string, suffix: string): string {
    const code = customerCode.trim()
    const no = suffix.trim()
    const prefix = `${code}-`
    return no.startsWith(prefix) ? no : `${prefix}${no}`
  }

  /** OMS 客户下单：扣余额、扣减货盘剩余、累计已售，并将库存转入客户账号 */
  async recordPurchase(input: OmsPurchaseInput) {
    const orderNo = String(input.orderNo || '').trim()
    const sku = String(input.sku || '').trim()
    const quantity = Math.floor(num(input.quantity))
    if (!orderNo) throw new BadRequestException('缺少订单号 orderNo')
    if (!sku) throw new BadRequestException('缺少 SKU')
    if (!Number.isFinite(quantity) || quantity <= 0) throw new BadRequestException('购买数量须大于 0')

    const existing = await this.prisma.omsCatalogOrder.findUnique({ where: { orderNo } })
    if (existing) {
      const pricing = existing.pricingId
        ? await this.prisma.productPricing.findUnique({ where: { id: existing.pricingId } })
        : await this.prisma.productPricing.findUnique({ where: { sku: existing.sku } })
      return this.buildPurchaseResult(existing, {
        soldQty: pricing?.soldQty ?? 0,
        remainingStockQty: pricing ? remainingCatalogStock(pricing) : 0,
        catalogStockPool: pricing ? catalogStockPool(pricing) : 0,
        balanceBefore: existing.balanceBefore != null ? num(existing.balanceBefore) : null,
        balanceAfter: existing.balanceAfter != null ? num(existing.balanceAfter) : null,
        idempotent: true,
      })
    }

    let customerId = input.customerId ? BigInt(input.customerId) : null
    if (!customerId && input.customerCode?.trim()) {
      const customer = await this.prisma.customer.findUnique({
        where: { customerCode: input.customerCode.trim() },
      })
      if (!customer) throw new NotFoundException(`客户代码 ${input.customerCode} 不存在`)
      customerId = customer.id
    }
    if (!customerId) throw new BadRequestException('请提供 customerId 或 customerCode')

    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } })
    if (!customer) throw new NotFoundException('客户不存在')
    if (customer.status !== 1) throw new BadRequestException('客户已停用，无法下单')

    const pricing = await this.prisma.productPricing.findUnique({ where: { sku } })
    if (!pricing) throw new NotFoundException(`SKU ${sku} 不在货盘库存中`)
    if (!pricing.visibleOnOms) throw new BadRequestException(`SKU ${sku} 尚未同步至 OMS`)
    if (!pricing.orderableOnOms) throw new BadRequestException(`SKU ${sku} 当前不可下单（待海外仓库存或已售罄）`)

    const remainBefore = remainingCatalogStock(pricing)
    if (quantity > remainBefore) {
      throw new BadRequestException(`SKU ${sku} 货盘剩余 ${remainBefore} 件，不足以购买 ${quantity} 件`)
    }

    const unitPrice = input.unitPrice != null ? num(input.unitPrice) : num(pricing.finalPrice)
    if (unitPrice <= 0) throw new BadRequestException('缺少有效单价')

    const totalAmount = Math.round(unitPrice * quantity * 100) / 100
    const balanceBefore = num(customer.balance)
    if (balanceBefore < totalAmount) {
      throw new BadRequestException(
        `客户余额不足：可用 ¥${balanceBefore.toFixed(2)}，需支付 ¥${totalAmount.toFixed(2)}`,
      )
    }
    const balanceAfter = Math.round((balanceBefore - totalAmount) * 100) / 100

    const newSoldQty = (pricing.soldQty ?? 0) + quantity
    const pool = catalogStockPool(pricing)
    const remainAfter = Math.max(0, pool - newSoldQty)
    const shouldCloseOrderable = remainAfter <= 0

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.omsCatalogOrder.create({
        data: {
          orderNo,
          customerId,
          customerCode: customer.customerCode,
          sku,
          quantity,
          unitPrice,
          totalAmount,
          balanceBefore,
          balanceAfter,
          pricingId: pricing.id,
          status: 'confirmed',
        },
      })

      await tx.customer.update({
        where: { id: customerId! },
        data: { balance: balanceAfter },
      })

      const chargeSuffix = await this.nextChargeSuffix(tx, customerId!)
      const chargeNo = this.formatChargeNo(customer.customerCode, chargeSuffix)
      const chargeDate = new Date().toISOString().slice(0, 10)
      await tx.$executeRawUnsafe(
        `INSERT INTO billing_charge (charge_no, customer_id, charge_type, source, description, amount, quantity, unit_price, charge_date, biz_ref, source_ref, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        chargeNo,
        customerId,
        'catalog_purchase',
        'oms',
        `货盘采购 ${sku} × ${quantity}（订单 ${orderNo}，已从余额扣款）`,
        totalAmount,
        quantity,
        unitPrice,
        chargeDate,
        orderNo,
        sku,
        'confirmed',
      )

      await tx.productPricing.update({
        where: { id: pricing.id },
        data: {
          soldQty: newSoldQty,
          ...(shouldCloseOrderable ? { orderableOnOms: false } : {}),
        },
      })

      const holding = await tx.customerSkuInventory.findUnique({
        where: { customerId_sku: { customerId: customerId!, sku } },
      })
      if (holding) {
        await tx.customerSkuInventory.update({
          where: { id: holding.id },
          data: {
            quantity: holding.quantity + quantity,
            unitPrice,
            productName: pricing.productName,
            pricingId: pricing.id,
          },
        })
      } else {
        await tx.customerSkuInventory.create({
          data: {
            customerId: customerId!,
            sku,
            productName: pricing.productName,
            quantity,
            unitPrice,
            pricingId: pricing.id,
          },
        })
      }

      await tx.productPricingHistory.create({
        data: {
          pricingId: pricing.id,
          operatorRole: 'OMS',
          action: '客户购买',
          detail: `客户 ${customer.customerCode} 下单 ${orderNo}，购买 ${quantity} 件，扣款 ¥${totalAmount}（余额 ¥${balanceBefore} → ¥${balanceAfter}）；已售 ${newSoldQty}/${pool}，剩余 ${remainAfter} 件`,
        },
      })

      await tx.syncLog.create({
        data: {
          syncType: 'oms_catalog_purchase',
          targetSystem: 'ERP',
          referenceNo: orderNo,
          status: 'success',
          requestBody: input as object,
          responseBody: {
            sku,
            quantity,
            totalAmount,
            balanceBefore,
            balanceAfter,
            soldQty: newSoldQty,
            remainingStockQty: remainAfter,
            customerId: Number(customerId),
          },
        },
      })

      return created
    })

    await pushCatalogStockToOms(this.prisma, sku)

    return this.buildPurchaseResult(order, {
      soldQty: newSoldQty,
      remainingStockQty: remainAfter,
      catalogStockPool: pool,
      balanceBefore,
      balanceAfter,
      idempotent: false,
    })
  }

  private buildPurchaseResult(
    order: {
      id: bigint
      orderNo: string
      customerId: bigint
      customerCode: string | null
      sku: string
      quantity: number
      unitPrice: unknown
      totalAmount: unknown
      balanceBefore?: unknown
      balanceAfter?: unknown
      pricingId: bigint | null
      status: string
      createdAt: Date
    },
    extra: {
      soldQty: number
      remainingStockQty: number
      catalogStockPool: number
      balanceBefore: number | null
      balanceAfter: number | null
      idempotent: boolean
    },
  ) {
    return {
      id: Number(order.id),
      orderNo: order.orderNo,
      customerId: Number(order.customerId),
      customerCode: order.customerCode,
      sku: order.sku,
      quantity: order.quantity,
      unitPrice: num(order.unitPrice),
      totalAmount: num(order.totalAmount),
      balanceBefore: extra.balanceBefore ?? (order.balanceBefore != null ? num(order.balanceBefore) : null),
      balanceAfter: extra.balanceAfter ?? (order.balanceAfter != null ? num(order.balanceAfter) : null),
      pricingId: order.pricingId ? Number(order.pricingId) : null,
      status: order.status,
      createdAt: order.createdAt,
      soldQty: extra.soldQty,
      remainingStockQty: extra.remainingStockQty,
      catalogStockPool: extra.catalogStockPool,
      idempotent: extra.idempotent,
    }
  }
}
