/**
 * 为各功能模块补全演示数据（仅当对应表为空时写入，可重复执行）
 * 用法: DATABASE_URL=... node scripts/ensure-missing-demo.mjs
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function ensureAnnouncement() {
  if (await prisma.announcement.count()) return
  await prisma.announcement.create({
    data: {
      title: 'Takealot ERP 系统上线',
      category: '系统',
      content: '主链路模块已接入真实 API，请使用各角色账号登录体验。',
      targetChannel: 'erp',
      status: 'published',
      isPinned: true,
      publishedAt: new Date(),
    },
  })
  console.log('✓ 公告演示数据')
}

async function ensureLeadFollowAndDeal() {
  const lead = await prisma.lead.findFirst({ orderBy: { id: 'asc' } })
  if (!lead) return
  const admin = await prisma.sysUser.findUnique({ where: { username: 'admin' } })
  if (!(await prisma.leadFollowUp.count())) {
    await prisma.leadFollowUp.create({
      data: {
        leadId: lead.id,
        followType: 'phone',
        content: '首次电话沟通，客户对海外仓代发感兴趣',
        nextPlan: '发送报价方案',
        nextFollowAt: new Date(Date.now() + 86400000 * 3),
        operatorId: admin?.id,
      },
    })
    console.log('✓ 线索跟进演示数据')
  }
  if (!(await prisma.leadDeal.count())) {
    await prisma.leadDeal.create({
      data: {
        leadId: lead.id,
        dealNo: 'DEAL-DEMO-001',
        dealAmount: 50000,
        dealDate: new Date(),
        productDesc: '3C配件代发首单',
        status: 'confirmed',
        remark: '签约首单代发',
      },
    })
    console.log('✓ 成交管理演示数据')
  }
}

async function ensurePutaway() {
  if (await prisma.inboundPutawayItem.count()) return
  const inbound = await prisma.inboundOrder.findFirst({
    where: { status: { in: ['receiving', 'confirmed', 'putaway'] } },
    include: { items: { take: 1 } },
  })
  const location = await prisma.warehouseLocation.findFirst({
    where: { warehouseCode: 'WMS-JHB-01' },
  })
  if (!inbound?.items[0] || !location) return
  await prisma.inboundPutawayItem.create({
    data: {
      inboundId: inbound.id,
      inboundItemId: inbound.items[0].id,
      locationId: location.id,
      locationCode: location.locationCode,
      qty: Math.min(inbound.items[0].actualQty || inbound.items[0].expectedQty, 10),
      operatorId: (await prisma.sysUser.findUnique({ where: { username: 'admin' } }))?.id,
    },
  })
  console.log('✓ 入库上架演示数据')
}

async function ensureCustomerFinance() {
  if (!(await prisma.customer.count())) {
    await prisma.customer.create({
      data: {
        customerCode: 'CUS-DEMO-001',
        customerName: '开普敦贸易',
        contactName: 'John',
        contactPhone: '+27-82-1234567',
        balance: 50000,
        status: 1,
      },
    })
    console.log('✓ 客户演示数据')
  }
  const customer = await prisma.customer.findFirst()
  if (!customer) return

  if (!(await prisma.customerRecharge.count())) {
    await prisma.customerRecharge.create({
      data: {
        rechargeNo: 'RC-DEMO-001',
        customerId: customer.id,
        amount: 10000,
        paymentMethod: 'bank',
        status: 'confirmed',
        remark: '首笔充值',
      },
    })
    console.log('✓ 客户充值演示数据')
  }

  if (!(await prisma.billingOrder.count())) {
    await prisma.billingOrder.create({
      data: {
        billingNo: 'BL-DEMO-202607',
        customerId: customer.id,
        billingMonth: '2026-07',
        totalAmount: 8500,
        paidAmount: 5000,
        status: 'partial',
        items: {
          create: [
            { itemType: 'storage', description: '仓储费', quantity: 1, unitPrice: 3500, amount: 3500 },
            { itemType: 'outbound', description: '出库操作费', quantity: 50, unitPrice: 100, amount: 5000 },
          ],
        },
      },
    })
    console.log('✓ 客户结算演示数据')
  }
}

async function ensureOutbound() {
  if (await prisma.outboundOrder.count()) return
  const product = await prisma.product.findFirst()
  const customer = await prisma.customer.findFirst()
  const admin = await prisma.sysUser.findUnique({ where: { username: 'admin' } })
  if (!product) return
  await prisma.outboundOrder.create({
    data: {
      outboundNo: 'OB-DEMO-001',
      customerId: customer?.id,
      warehouseCode: 'WMS-JHB-01',
      destType: 'cpt',
      status: 'pending_pick',
      createdBy: admin?.id,
      items: {
        create: [{
          productId: product.id,
          sku: product.sku,
          productName: product.productName,
          qty: 10,
        }],
      },
    },
  })
  console.log('✓ 出库单演示数据')
}

async function ensureFreightBill() {
  if (await prisma.supplierFreightBill.count()) return
  const supplier = await prisma.supplier.findFirst()
  if (!supplier) return
  await prisma.supplierFreightBill.create({
    data: {
      billNo: 'FB-DEMO-001',
      supplierId: supplier.id,
      billMonth: '2026-07',
      totalAmount: 12500,
      containerCount: 2,
      status: 'draft',
      remark: '海运账单演示',
    },
  })
  console.log('✓ 海运账单演示数据')
}

async function ensureProfitAnalysis() {
  if (await prisma.profitAnalysis.count()) return
  const product = await prisma.product.findFirst()
  if (!product) return
  await prisma.profitAnalysis.create({
    data: {
      productId: product.id,
      sku: product.sku,
      analysisMonth: '2026-07',
      salesQty: 120,
      salesAmount: 96000,
      totalCost: 15000,
      grossProfit: 8500,
      profitRate: 0.362,
      remark: '利润分析演示',
    },
  })
  console.log('✓ 利润分析演示数据')
}

async function ensureSyncAndAsyncIo() {
  if (!(await prisma.syncLog.count())) {
    await prisma.syncLog.create({
      data: {
        syncType: 'product',
        targetSystem: 'oms',
        referenceNo: 'SYNC-DEMO-001',
        status: 'success',
        responseBody: { recordCount: 5, message: '商品同步 OMS 成功（演示）' },
      },
    })
    console.log('✓ 同步日志演示数据')
  }
  if (!(await prisma.asyncIoJob.count())) {
    await prisma.asyncIoJob.create({
      data: {
        jobNo: 'IO-DEMO-001',
        jobType: 'export',
        module: 'inventory',
        fileName: 'inventory-export-demo.xlsx',
        status: 'completed',
        totalRows: 6,
        processedRows: 6,
        finishedAt: new Date(),
      },
    })
    console.log('✓ 异步导出演示数据')
  }
}

async function main() {
  await ensureAnnouncement()
  await ensureLeadFollowAndDeal()
  await ensurePutaway()
  await ensureCustomerFinance()
  await ensureOutbound()
  await ensureFreightBill()
  await ensureProfitAnalysis()
  await ensureSyncAndAsyncIo()
  console.log('\n补全完成')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
