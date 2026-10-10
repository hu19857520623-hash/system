import type { Prisma } from '@prisma/client'

/** OMS 商品及其预约入库所需的仓内档案，不属于 ERP 商品主数据。 */
export const OMS_MANAGED_PRODUCT_WHERE: Prisma.ProductWhereInput = {
  OR: [
    { remark: { contains: 'OMS客户:' } },
    { remark: { contains: 'OMS 预约入库自动建档' } },
  ],
}

export const ERP_MASTER_PRODUCT_WHERE: Prisma.ProductWhereInput = {
  OR: [
    { remark: null },
    {
      AND: [
        { remark: { not: { contains: 'OMS客户:' } } },
        { remark: { not: { contains: 'OMS 预约入库自动建档' } } },
      ],
    },
  ],
}
