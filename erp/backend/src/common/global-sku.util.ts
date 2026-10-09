import { BadRequestException } from '@nestjs/common'
import { Prisma } from '@prisma/client'

/** 同一实物在 ERP/OMS 的镜像可共用编号；不同商品不能靠客户前缀绕过唯一性。 */
export async function assertGlobalSkuAvailable(db: { $queryRaw: any }, input: {
  sku: string
  customerSku?: string | null
  excludeErpSku?: string
  excludeOmsId?: string
  mirrorOmsSku?: string
}) {
  const baseSku = /^TKL[0-9]*-/i.test(input.sku) ? input.sku.slice(input.sku.indexOf('-') + 1) : input.sku
  const keys = [...new Set([input.sku, input.customerSku || baseSku].map(value => String(value || '').trim()).filter(Boolean))]
  if (!keys.length) return
  const rows = await db.$queryRaw(Prisma.sql`
    SELECT sku AS code FROM product
    WHERE sku <> ${input.excludeErpSku || ''} AND (
      sku IN (${Prisma.join(keys)}) OR customer_sku IN (${Prisma.join(keys)})
      OR ((customer_sku IS NULL OR customer_sku = '') AND sku REGEXP '^TKL[0-9]*-' AND SUBSTRING(sku, LOCATE('-', sku) + 1) IN (${Prisma.join(keys)}))
    )
    UNION ALL
    SELECT internalSku AS code FROM oms_product
    WHERE id <> ${input.excludeOmsId || ''} AND internalSku <> ${input.mirrorOmsSku || ''} AND (
      internalSku IN (${Prisma.join(keys)}) OR customerSku IN (${Prisma.join(keys)})
      OR ((customerSku IS NULL OR customerSku = '') AND internalSku REGEXP '^TKL[0-9]*-' AND SUBSTRING(internalSku, LOCATE('-', internalSku) + 1) IN (${Prisma.join(keys)}))
    )
    UNION ALL
    SELECT sku AS code FROM product_dev WHERE sku <> ${input.sku} AND sku IN (${Prisma.join(keys)})
    LIMIT 1
  `) as Array<{ code: string }>
  if (rows.length) throw new BadRequestException(`重复 SKU：${input.customerSku || input.sku}（全局不可重复）`)
}
