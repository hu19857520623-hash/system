import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import {
  ALL_PERM_CODES,
  ROLE_CODE_TEMPLATE,
  ROLE_DEFINITIONS,
  ROLE_PERM_TEMPLATES,
  permLabel,
  permModule,
} from '../../shared/permissions.catalog'
import { toCatalogInternalSku } from '../src/common/catalog-customer.util'

const prisma = new PrismaClient()

const DEFAULT_PASSWORD = '123456'

const SEED_ROLES = ROLE_DEFINITIONS.map(({ roleCode, roleName, description }) => ({
  roleCode,
  roleName,
  description,
}))

/** 与前端 ACCOUNTS 登录名一致 */
const SEED_USERS = [
  { username: 'admin', realName: '系统管理员', roleCode: 'admin' },
  { username: 'zhaomin', realName: '赵敏', roleCode: 'ops_manager' },
  { username: 'liuyang', realName: '刘洋', roleCode: 'ops_manager' },
  { username: 'zhoujie', realName: '周杰', roleCode: 'viewer' },
  { username: 'sunhao', realName: '孙浩', roleCode: 'purchaser' },
  { username: 'linxinyi', realName: '林心仪', roleCode: 'cs' },
  { username: 'wangfang', realName: '王芳', roleCode: 'finance' },
  { username: 'chenqi', realName: '陈琪', roleCode: 'coach' },
  // 兼容旧账号
  { username: 'ops', realName: '李四', roleCode: 'ops_manager' },
  { username: 'buyer', realName: '孙浩', roleCode: 'purchaser' },
  { username: 'wh', realName: '周九', roleCode: 'warehouse' },
  { username: 'finance', realName: '财务', roleCode: 'finance' },
  { username: 'cs', realName: '林心仪', roleCode: 'cs' },
  { username: 'guest', realName: '访客', roleCode: 'viewer' },
]

/** 为已有商品补全开发人/采购员（可重复执行） */
async function backfillProductRelations() {
  const [devUser, purchaserUser] = await Promise.all([
    prisma.sysUser.findUnique({ where: { username: 'zhaomin' } }),
    prisma.sysUser.findUnique({ where: { username: 'sunhao' } }),
  ])

  const devs = await prisma.productDev.findMany({
    where: { sku: { not: null }, applicantId: { not: null }, status: 'approved' },
    select: { sku: true, applicantId: true },
  })
  for (const d of devs) {
    if (!d.sku) continue
    await prisma.product.updateMany({
      where: { sku: d.sku, developerId: null },
      data: { developerId: d.applicantId },
    })
  }

  const poItems = await prisma.purchaseOrderItem.findMany({
    select: { sku: true, order: { select: { purchaserId: true, createdAt: true } } },
    orderBy: { createdAt: 'desc' },
  })
  const purchaserBySku = new Map<string, bigint>()
  for (const item of poItems) {
    const pid = item.order?.purchaserId
    if (pid && !purchaserBySku.has(item.sku)) purchaserBySku.set(item.sku, pid)
  }
  for (const [sku, purchaserId] of purchaserBySku) {
    await prisma.product.updateMany({
      where: { sku, purchaserId: null },
      data: { purchaserId },
    })
  }

  if (devUser) {
    const n = await prisma.product.updateMany({
      where: { developerId: null },
      data: { developerId: devUser.id },
    })
    if (n.count) console.log(`✓ 已补全 ${n.count} 个商品的开发人`)
  }
  if (purchaserUser) {
    const n = await prisma.product.updateMany({
      where: { purchaserId: null },
      data: { purchaserId: purchaserUser.id },
    })
    if (n.count) console.log(`✓ 已补全 ${n.count} 个商品的采购员`)
  }
}

async function seedDemoData() {
  const productCount = await prisma.product.count()
  if (productCount > 0) {
    console.log('✓ 业务演示数据已存在，跳过')
    return
  }

  const [devUser, purchaserUser] = await Promise.all([
    prisma.sysUser.findUnique({ where: { username: 'zhaomin' } }),
    prisma.sysUser.findUnique({ where: { username: 'sunhao' } }),
  ])

  const s1 = await prisma.supplier.create({
    data: {
      supplierCode: 'SUP-SZ-001',
      supplierName: '深圳优品电子',
      contactName: '张经理',
      contactPhone: '13800138001',
      city: '深圳',
      status: 1,
    },
  })
  const s2 = await prisma.supplier.create({
    data: {
      supplierCode: 'SUP-GZ-002',
      supplierName: '广州家居供应链',
      contactName: '李总',
      city: '广州',
      status: 1,
    },
  })

  const devId = devUser?.id
  const purchaserId = purchaserUser?.id

  const products = await Promise.all([
    prisma.product.create({
      data: {
        sku: 'TK-88421', spu: 'SPU-BT-100', productName: '无线蓝牙耳机 Pro', spec: '黑色',
        lengthCm: 18, widthCm: 12, heightCm: 6, weightKg: 0.18, costRmb: 89.5,
        barcode: '6901234567892', supplierId: s1.id, developerId: devId, purchaserId,
        status: 'active', syncStatus: 'synced',
      },
    }),
    prisma.product.create({
      data: {
        sku: 'TK-77210', spu: 'SPU-HM-220', productName: '硅胶厨房收纳', spec: '6件套',
        lengthCm: 32, widthCm: 28, heightCm: 12, weightKg: 1.2, costRmb: 156,
        barcode: '6901234567885', supplierId: s2.id, developerId: devId, purchaserId,
        status: 'active', syncStatus: 'synced',
      },
    }),
    prisma.product.create({
      data: {
        sku: 'TK-66105', spu: 'SPU-EL-088', productName: 'USB-C 数据线', spec: '1m白',
        costRmb: 12.8, barcode: '6901234567878', supplierId: s1.id, developerId: devId, purchaserId,
        status: 'active', syncStatus: 'synced',
      },
    }),
    prisma.product.create({
      data: {
        sku: 'TK-99001', spu: 'SPU-BT-200', productName: 'ANC 降噪耳机 Max', spec: '黑色',
        lengthCm: 30, widthCm: 20, heightCm: 15, weightKg: 0.5,
        costRmb: 128, supplierId: s1.id, developerId: devId, purchaserId,
        status: 'active', syncStatus: 'synced',
      },
    }),
    prisma.product.create({
      data: {
        sku: 'TK-99002', spu: 'SPU-BT-201', productName: '无线运动耳机', spec: '蓝色',
        costRmb: 89.5, supplierId: s1.id, developerId: devId, purchaserId,
        status: 'active', syncStatus: 'synced',
      },
    }),
    prisma.product.create({
      data: {
        sku: 'TK-55032', spu: 'SPU-HM-115', productName: '不锈钢保温杯', spec: '500ml',
        costRmb: 45.2, supplierId: s2.id, developerId: devId, purchaserId,
        status: 'pending', syncStatus: 'pending',
      },
    }),
  ])

  await prisma.productDev.createMany({
    data: [
      { applyNo: 'PD-2026-0088', productName: 'ANC 降噪耳机 Max', spec: '黑色', estimatedCost: 128, marketPrice: 899, status: 'approved', purchaseQty: 2000, takealotUrl: 'https://www.takealot.com' },
      { applyNo: 'PD-2026-0087', productName: '无线运动耳机', spec: '蓝色', estimatedCost: 89.5, marketPrice: 599, status: 'approved', purchaseQty: 1500, takealotUrl: 'https://www.takealot.com' },
      { applyNo: 'PD-2026-0086', productName: '硅胶厨房收纳', spec: '6件套', estimatedCost: 156, marketPrice: 1988, status: 'submitted', takealotUrl: 'https://www.takealot.com' },
      { applyNo: 'PD-2026-0085', productName: '不锈钢保温杯', spec: '500ml', estimatedCost: 45.2, marketPrice: 299, status: 'submitted', takealotUrl: 'https://www.takealot.com' },
      { applyNo: 'PD-2026-0084', productName: 'USB-C 数据线', spec: '1m白', estimatedCost: 12.8, marketPrice: 99, status: 'draft' },
    ],
  })

  const po = await prisma.purchaseOrder.create({
    data: {
      poNo: 'PO-2026-06089',
      supplierId: s1.id,
      purchaserId,
      warehouseCode: 'LW-SZ-01',
      totalAmount: 256000,
      status: 'approved',
      items: {
        create: [{ productId: products[3].id, sku: 'TK-99001', productName: 'ANC 降噪耳机 Max', quantity: 2000, unitPrice: 128, amount: 256000 }],
      },
    },
  })

  await prisma.purchaseOrder.create({
    data: {
      poNo: 'PO-2026-06090',
      supplierId: s1.id,
      purchaserId,
      warehouseCode: 'LW-SZ-01',
      totalAmount: 134250,
      status: 'finance_approved',
      items: {
        create: [{ productId: products[4].id, sku: 'TK-99002', productName: '无线运动耳机', quantity: 1500, unitPrice: 89.5, amount: 134250 }],
      },
    },
  })

  const po2 = await prisma.purchaseOrder.create({
    data: {
      poNo: 'PO-2026-06088',
      supplierId: s1.id,
      purchaserId,
      warehouseCode: 'LW-SZ-01',
      totalAmount: 178900,
      status: 'finance_approved',
      expectedArrival: new Date('2026-06-18'),
      items: {
        create: [
          { productId: products[3].id, sku: 'TK-99001', productName: 'ANC 降噪耳机 Max', quantity: 1000, unitPrice: 128, amount: 128000 },
          { productId: products[0].id, sku: 'TK-88421', productName: '蓝牙音箱 Mini', quantity: 500, unitPrice: 101.8, amount: 50900 },
        ],
      },
    },
  })

  await prisma.inboundOrder.create({
    data: {
      inboundNo: 'IN-2026-0412',
      poId: po.id,
      warehouseCode: 'LW-SZ-01',
      status: 'pending_receipt',
      remark: '[采购入库] 标签:50×30mm',
      items: {
        create: [{ productId: products[3].id, sku: 'TK-99001', expectedQty: 2000 }],
      },
    },
  })
  await prisma.inboundOrder.create({
    data: {
      inboundNo: 'IN-2026-0410',
      poId: po2.id,
      warehouseCode: 'LW-SZ-01',
      status: 'confirmed',
      remark: '[采购入库]',
      items: {
        create: [{ productId: products[3].id, sku: 'TK-99001', expectedQty: 1000, actualQty: 1000 }],
      },
    },
  })

  // 定价演示数据（货盘归属平台客户 TKL，SKU 前缀 TKL-）
  const catalogSkus: string[] = []
  const cs = (base: string) => {
    const sku = toCatalogInternalSku(base, catalogSkus)
    catalogSkus.push(sku)
    return sku
  }

  const p1 = await prisma.productPricing.create({
    data: {
      sku: cs('TK-99001'), productName: 'ANC 降噪耳机 Max', spec: '黑色', costRmb: 128, purchaseQty: 2000,
      poNo: po.poNo, inboundNo: 'WH-2026-045', seaFreight: 12, domesticFee: 5, exchangeRate: 2.5,
      freightCallbackAt: new Date('2026-06-21T09:30:00'),
      marketPrice: 899, pricingLogic: '对标市场价 -5%', targetProfitRate: 32, finalPrice: 799,
      pricingStatus: 'priced',
    },
  })
  const p2 = await prisma.productPricing.create({
    data: {
      sku: cs('TK-99002'), productName: '无线运动耳机', spec: '蓝色', costRmb: 89.5, purchaseQty: 1500,
      poNo: 'PO-2026-06090', inboundNo: 'WH-2026-046', seaFreight: 8, domesticFee: 4,
      freightCallbackAt: new Date('2026-06-22T10:10:00'), marketPrice: 599, pricingStatus: 'pending_pricing',
    },
  })
  const p3 = await prisma.productPricing.create({
    data: {
      sku: cs('TK-66105'), productName: 'USB-C 数据线', spec: '1m白', costRmb: 12.8, purchaseQty: 5000,
      poNo: 'PO-2026-06072', inboundNo: 'WH-2026-040', seaFreight: 2, domesticFee: 1,
      freightCallbackAt: new Date('2026-06-17T09:00:00'),
      marketPrice: 129, pricingLogic: '成本加成 60%', targetProfitRate: 45, finalPrice: 79,
      platformCommissionRate: 33, platformDeliveryFee: 25,
      pricingStatus: 'synced', omsSyncAt: new Date('2026-07-02T11:18:00'),
    },
  })
  await prisma.productPricing.create({
    data: {
      sku: cs('TK-77210'), productName: '硅胶厨房收纳', spec: '6件套', costRmb: 156, purchaseQty: 800,
      poNo: 'PO-2026-06091', pricingStatus: 'waiting_freight',
    },
  })

  await prisma.productPricingHistory.createMany({
    data: [
      { pricingId: p1.id, operatorRole: '采购', action: '海运费回传', detail: '入库单 WH-2026-045 回传：海运费 ¥12 / 国内 ¥5' },
      { pricingId: p1.id, operatorRole: '产品开发主管', action: '确认最终售价', detail: '最终售价 R799（对标市场价 -5%）' },
      { pricingId: p2.id, operatorRole: '采购', action: '海运费回传', detail: '入库单 WH-2026-046 回传：海运费 ¥8 / 国内 ¥4' },
    ],
  })
  await prisma.productPriceRecord.createMany({
    data: [
      { pricingId: p3.id, marketPrice: 129, price: 99, operator: '陪跑', note: '首次同步 OMS' },
      { pricingId: p3.id, marketPrice: 109, price: 89, operator: '陪跑', note: '竞品降价，跟进调价' },
      { pricingId: p3.id, marketPrice: 99, price: 79, operator: '陪跑', note: '市场持续走低，保持竞争力' },
    ],
  })

  await prisma.lead.createMany({
    data: [
      { leadNo: 'LD-2026-001', companyName: '开普敦贸易', contactName: 'John', contactPhone: '+27-82-1234567', source: '展会', status: 'new' },
      { leadNo: 'LD-2026-002', companyName: '约堡电商', contactName: 'Sarah', contactPhone: '+27-83-7654321', source: '官网', status: 'following' },
      { leadNo: 'LD-2026-003', companyName: '德班零售', contactName: 'Mike', source: '转介绍', status: 'deal' },
    ],
  })

  await prisma.customer.create({
    data: {
      customerCode: 'TKL',
      customerName: '平台货盘',
      contactName: '系统',
      balance: 0,
      status: 1,
    },
  })

  await prisma.customer.create({
    data: {
      customerCode: 'TKL0001',
      customerName: '开普敦贸易',
      contactName: 'John',
      contactPhone: '+27-82-1234567',
      balance: 50000,
      status: 1,
    },
  })

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

  await prisma.inventory.create({
    data: {
      productId: products[2].id,
      sku: 'TK-66105',
      warehouseCode: 'WMS-JHB-01',
      totalQty: 5000,
      availableQty: 3200,
      lockedQty: 200,
    },
  })

  console.log('✓ 业务演示数据已写入')
}

async function ensureLogisticsDemo() {
  const tk = await prisma.product.findFirst({ where: { sku: 'TK-99001' } })
  if (!tk) return
  const exists = await prisma.inventory.findFirst({ where: { sku: 'TK-99001', warehouseCode: 'LW-SZ-01' } })
  if (!exists) {
    await prisma.inventory.create({
      data: { productId: tk.id, sku: 'TK-99001', warehouseCode: 'LW-SZ-01', totalQty: 500, availableQty: 500 },
    })
    console.log('✓ 物流仓示例库存已写入')
  }
}

async function seedPermissions() {
  for (const permCode of ALL_PERM_CODES) {
    await prisma.sysPermission.upsert({
      where: { permCode },
      create: { permCode, permName: permLabel(permCode), module: permModule(permCode) },
      update: { permName: permLabel(permCode), module: permModule(permCode) },
    })
  }

  for (const [roleCode, templateKey] of Object.entries(ROLE_CODE_TEMPLATE)) {
    const perms = ROLE_PERM_TEMPLATES[templateKey] || []
    await prisma.sysRolePermission.deleteMany({ where: { roleCode } })
    if (perms.length) {
      await prisma.sysRolePermission.createMany({
        data: perms.map((permCode) => ({ roleCode, permCode })),
        skipDuplicates: true,
      })
    }
  }
  console.log(`✓ 权限数据已同步 (${ALL_PERM_CODES.length} 项)`)
}

async function seedWarehouseLocations() {
  const whCode = 'WMS-JHB-01'
  const wh = await prisma.warehouse.findUnique({ where: { warehouseCode: whCode } })
  if (!wh) return

  const zoneDefs = [
    { zoneCode: 'ZONE-A', zoneName: 'A 区存储', zoneType: 'storage' },
    { zoneCode: 'ZONE-B', zoneName: 'B 区存储', zoneType: 'storage' },
    { zoneCode: 'STAGE-01', zoneName: '待上架区', zoneType: 'staging' },
  ]

  const zoneIds: Record<string, bigint> = {}
  for (const z of zoneDefs) {
    const row = await prisma.warehouseZone.upsert({
      where: { warehouseCode_zoneCode: { warehouseCode: whCode, zoneCode: z.zoneCode } },
      create: { warehouseCode: whCode, ...z },
      update: { zoneName: z.zoneName, zoneType: z.zoneType, status: 1 },
    })
    zoneIds[z.zoneCode] = row.id
  }

  const locCount = await prisma.warehouseLocation.count({ where: { warehouseCode: whCode } })
  if (locCount > 0) {
    console.log(`✓ 库位种子已存在 (${locCount} 个)，跳过生成`)
    return
  }

  const toCreate: { warehouseCode: string; locationCode: string; zoneId: bigint }[] = []
  for (const letter of ['A', 'B']) {
    const zoneId = zoneIds[`ZONE-${letter}`]
    for (let n = 1; n <= 20; n++) {
      toCreate.push({
        warehouseCode: whCode,
        locationCode: `JHB-${letter}-01-${String(n).padStart(2, '0')}`,
        zoneId,
      })
    }
  }
  toCreate.push({
    warehouseCode: whCode,
    locationCode: 'STAGE-01',
    zoneId: zoneIds['STAGE-01'],
  })

  await prisma.warehouseLocation.createMany({ data: toCreate })
  console.log(`✓ JHB 库位种子已写入 (${toCreate.length} 个)`)
}

async function main() {
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10)

  for (const role of SEED_ROLES) {
    await prisma.sysRole.upsert({
      where: { roleCode: role.roleCode },
      create: role,
      update: { roleName: role.roleName, description: role.description },
    })
  }
  console.log(`✓ 角色数据已同步 (${SEED_ROLES.length})`)

  await seedPermissions()

  for (const u of SEED_USERS) {
    await prisma.sysUser.upsert({
      where: { username: u.username },
      create: { ...u, passwordHash: hash, status: 1 },
      update: { passwordHash: hash, realName: u.realName, roleCode: u.roleCode, status: 1 },
    })
  }
  console.log(`✓ 用户已同步 (${SEED_USERS.length})，密码: ${DEFAULT_PASSWORD}`)

  const whCount = await prisma.warehouse.count()
  if (whCount === 0) {
    await prisma.warehouse.createMany({
      data: [
        { warehouseCode: 'LW-SZ-01', warehouseName: '深圳集运物流仓', warehouseType: 'logistics', city: '深圳', country: 'China' },
        { warehouseCode: 'LW-YW-01', warehouseName: '义乌集运物流仓', warehouseType: 'logistics', city: '义乌', country: 'China' },
        { warehouseCode: 'WMS-JHB-01', warehouseName: 'JHB', warehouseType: 'wms', city: 'Johannesburg', country: 'South Africa' },
      ],
    })
    console.log('✓ 仓库种子数据已写入')
  }

  await seedWarehouseLocations()
  await seedDemoData()
  await backfillProductRelations()
  await ensureLogisticsDemo()

  console.log(`\n登录: POST http://localhost:3000/api/auth/login`)
  console.log(`示例: admin / ${DEFAULT_PASSWORD}  或  zhaomin / ${DEFAULT_PASSWORD}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
