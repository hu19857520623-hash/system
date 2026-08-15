import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import {
  CUSTOMER,
  announcements,
  codeMappings,
  customerAccounts,
  feeRecords,
  inboundOrders,
  inventory,
  logisticsRecords,
  orders,
  outboundOrders,
  platformSkuMappings,
  products,
  qcReports,
  stores,
  systemMessages,
} from '../src/data/mockData'
import {
  DEFAULT_PRICE_TEMPLATES,
  DEFAULT_REGION_DISPATCH_RULES,
  DEFAULT_STORAGE_TEMPLATE,
  DEFAULT_PAYMENT_METHODS,
} from '../src/data/feeTemplates'

const prisma = new PrismaClient()

function json(value: unknown): string {
  return JSON.stringify(value)
}

async function clearAll() {
  // 子表先删，避免外键冲突
  await prisma.feeRecord.deleteMany()
  await prisma.portalUser.deleteMany()
  await prisma.billingAccount.deleteMany()
  await prisma.regionDispatchRule.deleteMany()
  await prisma.storageRentTemplate.deleteMany()
  await prisma.priceTemplate.deleteMany()
  await prisma.paymentMethod.deleteMany()
  await prisma.announcement.deleteMany()
  await prisma.systemMessage.deleteMany()
  await prisma.qcReport.deleteMany()
  await prisma.logisticsRecord.deleteMany()
  await prisma.platformSkuMapping.deleteMany()
  await prisma.codeMapping.deleteMany()
  await prisma.outboundOrder.deleteMany()
  await prisma.inboundOrder.deleteMany()
  await prisma.order.deleteMany()
  await prisma.inventoryItem.deleteMany()
  await prisma.product.deleteMany()
  await prisma.storeAccount.deleteMany()
  await prisma.customerAccount.deleteMany()
}

async function main() {
  console.log('Clearing existing data...')
  await clearAll()

  console.log('Seeding customer accounts...')
  for (const c of customerAccounts) {
    await prisma.customerAccount.create({
      data: {
        id: c.id,
        name: c.name,
        code: c.code,
        type: c.type,
        contact: c.contact,
        email: c.email,
        status: c.status,
        permissions: json(c.permissions),
        warehouse: c.warehouse,
        createdAt: c.createdAt,
        lastLoginAt: c.lastLoginAt,
        priceTemplateId: c.priceTemplateId ?? null,
        priceTemplateByRegion: c.priceTemplateByRegion ? json(c.priceTemplateByRegion) : null,
      },
    })
  }

  // 默认账单挂在客户 1（南非优选贸易）
  console.log('Seeding billing...')
  await prisma.billingAccount.create({
    data: {
      id: 'default',
      customerId: '1',
      name: CUSTOMER.name,
      code: CUSTOMER.code,
      contact: CUSTOMER.contact,
      warehouse: CUSTOMER.warehouse,
      creditBalance: CUSTOMER.creditBalance,
      monthlySpent: CUSTOMER.monthlySpent,
      pendingBill: CUSTOMER.pendingBill,
      budgetUsed: CUSTOMER.budgetUsed,
    },
  })

  for (const f of feeRecords) {
    await prisma.feeRecord.create({
      data: {
        id: f.id,
        date: f.date,
        type: f.type,
        refNo: f.refNo,
        desc: f.desc,
        amount: f.amount,
        method: f.method ?? null,
        customerCode: f.customerCode ?? null,
        rechargeNo: f.rechargeNo ?? null,
        paymentMethodId: f.paymentMethodId ?? null,
        paymentMethodTitle: f.paymentMethodTitle ?? null,
      },
    })
  }

  console.log('Seeding stores...')
  for (const s of stores) {
    await prisma.storeAccount.create({
      data: {
        id: s.id,
        customerId: s.customerId ?? null,
        platform: s.platform,
        name: s.name,
        storeCode: s.storeCode,
        sellerId: s.sellerId,
        status: s.status,
        orderSync: s.orderSync,
        inventorySync: s.inventorySync,
        autoPullInterval: s.autoPullInterval,
        lastSyncAt: s.lastSyncAt,
        todayOrders: s.todayOrders,
        syncError: s.syncError ?? null,
        apiKeyMasked: s.apiKeyMasked,
        webhookUrl: s.webhookUrl,
        createdAt: s.createdAt,
      },
    })
  }

  console.log('Seeding products...')
  for (const p of products) {
    await prisma.product.create({
      data: {
        id: p.id,
        customerId: p.customerId ?? null,
        internalSku: p.internalSku,
        name: p.name,
        spec: p.spec,
        image: p.image,
        price: p.price,
        cost: p.cost,
        availableQty: p.availableQty,
        lockedQty: p.lockedQty,
        customCode: p.customCode ?? null,
        category: p.category,
        categoryPath: p.categoryPath,
        weight: p.weight,
        weightKg: p.weightKg,
        lengthCm: p.lengthCm,
        widthCm: p.widthCm,
        heightCm: p.heightCm,
        inCatalog: p.inCatalog,
        productStatus: p.productStatus,
        hasBattery: p.hasBattery,
        certUploaded: p.certUploaded,
        hasBoxSpec: p.hasBoxSpec,
        outerBoxBarcode: p.outerBoxBarcode ?? null,
        declaredNameEn: p.declaredNameEn,
        declaredNameCn: p.declaredNameCn,
        declaredValue: p.declaredValue,
        unit: p.unit,
      },
    })
  }

  console.log('Seeding inventory...')
  for (const i of inventory) {
    await prisma.inventoryItem.create({
      data: {
        id: i.id,
        customerId: i.customerId ?? null,
        sku: i.sku,
        name: i.name,
        image: i.image,
        available: i.available,
        locked: i.locked,
        inTransit: i.inTransit,
        safetyStock: i.safetyStock,
        spec: i.spec,
        customCode: i.customCode ?? null,
        ean: i.ean ?? null,
        warehouse: i.warehouse,
        pendingShelving: i.pendingShelving,
        pendingOutbound: i.pendingOutbound,
        defective: i.defective,
        shipped: i.shipped,
        warningQty: i.warningQty,
        price: i.price,
        declaredNameEn: i.declaredNameEn ?? null,
        categoryPath: i.categoryPath ?? null,
        stockSource: i.stockSource,
      },
    })
  }

  console.log('Seeding orders...')
  for (const o of orders) {
    await prisma.order.create({
      data: {
        id: o.id,
        orderNo: o.orderNo,
        customerId: o.customerId ?? null,
        platform: o.platform,
        store: o.store,
        country: o.country,
        countryCode: o.countryCode,
        skuCount: o.skuCount,
        warehouse: o.warehouse,
        logistics: o.logistics,
        status: o.status,
        exception: o.exception,
        exceptionReason: o.exceptionReason ?? null,
        amount: o.amount,
        createdAt: o.createdAt,
        recipient: o.recipient,
        address: o.address,
        items: json(o.items),
        tracking: json(o.tracking),
        fees: json(o.fees),
        logs: json(o.logs),
      },
    })
  }

  console.log('Seeding inbound / outbound...')
  for (const ib of inboundOrders) {
    await prisma.inboundOrder.create({
      data: {
        id: ib.id,
        customerId: ib.customerId ?? null,
        inboundNo: ib.inboundNo,
        source: ib.source,
        inboundType: ib.inboundType,
        deliveryMethod: ib.deliveryMethod,
        stockSource: ib.stockSource,
        boxCount: ib.boxCount,
        skuCount: ib.skuCount,
        totalQty: ib.totalQty,
        receivedQty: ib.receivedQty,
        status: ib.status,
        createdAt: ib.createdAt,
        eta: ib.eta ?? null,
        warehouse: ib.warehouse,
        referenceNo: ib.referenceNo ?? null,
        trackingNo: ib.trackingNo ?? null,
        contact: ib.contact ?? null,
        contactPhone: ib.contactPhone ?? null,
        skuHint: ib.skuHint ?? null,
        remark: ib.remark ?? null,
        exceptionCode: ib.exceptionCode ?? null,
        exceptionReason: ib.exceptionReason ?? null,
        lineItems: ib.lineItems ? json(ib.lineItems) : null,
        attachments: ib.attachments ? json(ib.attachments) : null,
      },
    })
  }

  for (const ob of outboundOrders) {
    await prisma.outboundOrder.create({
      data: {
        id: ob.id,
        customerId: ob.customerId ?? null,
        outboundNo: ob.outboundNo,
        source: ob.source,
        stockSource: ob.stockSource,
        refNo: ob.refNo ?? null,
        orderNo: ob.orderNo ?? null,
        type: ob.type,
        warehouse: ob.warehouse,
        items: ob.items,
        totalQty: ob.totalQty,
        status: ob.status,
        destination: ob.destination,
        createdAt: ob.createdAt,
        trackingNo: ob.trackingNo ?? null,
        shippingMethod: ob.shippingMethod ?? null,
        preDeductFees: ob.preDeductFees ? json(ob.preDeductFees) : null,
        scheduledDeliveryDate: ob.scheduledDeliveryDate ?? null,
        remark: ob.remark ?? null,
        exceptionCode: ob.exceptionCode ?? null,
        exceptionReason: ob.exceptionReason ?? null,
        lineItems: ob.lineItems ? json(ob.lineItems) : null,
        attachments: ob.attachments ? json(ob.attachments) : null,
      },
    })
  }

  console.log('Seeding code / platform mappings...')
  for (const m of codeMappings) {
    await prisma.codeMapping.create({
      data: {
        id: m.id,
        internalSku: m.internalSku,
        productName: m.productName,
        codeType: m.codeType,
        codeValue: m.codeValue,
        status: m.status,
        version: m.version,
        hasInventory: m.hasInventory,
        updatedAt: m.updatedAt,
        platformMappingId: m.platformMappingId ?? null,
      },
    })
  }

  for (const m of platformSkuMappings) {
    await prisma.platformSkuMapping.create({
      data: {
        id: m.id,
        customerId: m.customerId ?? null,
        platform: m.platform,
        storeId: m.storeId,
        storeName: m.storeName,
        platformSkuId: m.platformSkuId ?? null,
        platformBarcode: m.platformBarcode,
        platformTitle: m.platformTitle,
        platformListingId: m.platformListingId ?? null,
        lines: json(m.lines),
        status: m.status,
        stockSource: m.stockSource,
        syncSource: m.syncSource,
        version: m.version,
        hasInventory: m.hasInventory,
        lastSyncAt: m.lastSyncAt ?? null,
        updatedAt: m.updatedAt,
      },
    })
  }

  console.log('Seeding logistics / QC / messages...')
  for (const r of logisticsRecords) {
    await prisma.logisticsRecord.create({
      data: {
        id: r.id,
        refNo: r.refNo,
        outboundNo: r.outboundNo,
        carrier: r.carrier,
        trackingNo: r.trackingNo,
        status: r.status,
        destination: r.destination,
        updatedAt: r.updatedAt,
        podStatus: r.podStatus,
        podFileName: r.podFileName ?? null,
        podFileUrl: r.podFileUrl ?? null,
        podUploadedAt: r.podUploadedAt ?? null,
        exceptionCode: r.exceptionCode ?? null,
        exceptionReason: r.exceptionReason ?? null,
      },
    })
  }

  for (const q of qcReports) {
    await prisma.qcReport.create({ data: { ...q } })
  }

  for (const m of systemMessages) {
    await prisma.systemMessage.create({ data: { ...m } })
  }

  for (const a of announcements) {
    await prisma.announcement.create({ data: { ...a } })
  }

  console.log('Seeding fee templates...')
  for (const pt of DEFAULT_PRICE_TEMPLATES) {
    await prisma.priceTemplate.create({
      data: {
        id: pt.id,
        name: pt.name,
        regionCode: pt.regionCode,
        warehouseId: pt.warehouseId,
        status: pt.status,
        handling: json(pt.handling),
        shippingByRegion: json(pt.shippingByRegion),
        pickupByRegion: json(pt.pickupByRegion),
        updatedAt: pt.updatedAt,
      },
    })
  }

  await prisma.storageRentTemplate.create({
    data: {
      id: DEFAULT_STORAGE_TEMPLATE.id,
      name: DEFAULT_STORAGE_TEMPLATE.name,
      warehouseId: DEFAULT_STORAGE_TEMPLATE.warehouseId,
      status: DEFAULT_STORAGE_TEMPLATE.status,
      billingUnit: DEFAULT_STORAGE_TEMPLATE.billingUnit,
      pricePerCbmPerDay: DEFAULT_STORAGE_TEMPLATE.pricePerCbmPerDay,
      pricePerPiecePerDay: DEFAULT_STORAGE_TEMPLATE.pricePerPiecePerDay,
      minChargePerDay: DEFAULT_STORAGE_TEMPLATE.minChargePerDay,
      freeStorageDays: DEFAULT_STORAGE_TEMPLATE.freeStorageDays,
      updatedAt: DEFAULT_STORAGE_TEMPLATE.updatedAt,
    },
  })

  for (const r of DEFAULT_REGION_DISPATCH_RULES) {
    await prisma.regionDispatchRule.create({
      data: {
        id: r.id,
        code: r.code,
        label: r.label,
        shippingMethod: r.shippingMethod,
        enabled: r.enabled,
        remark: r.remark ?? null,
      },
    })
  }

  for (const pm of DEFAULT_PAYMENT_METHODS) {
    await prisma.paymentMethod.create({ data: { ...pm } })
  }

  const counts = {
    customers: await prisma.customerAccount.count(),
    products: await prisma.product.count(),
    inventory: await prisma.inventoryItem.count(),
    orders: await prisma.order.count(),
    inbound: await prisma.inboundOrder.count(),
    outbound: await prisma.outboundOrder.count(),
    stores: await prisma.storeAccount.count(),
    codeMappings: await prisma.codeMapping.count(),
    platformMappings: await prisma.platformSkuMapping.count(),
    logistics: await prisma.logisticsRecord.count(),
    feeRecords: await prisma.feeRecord.count(),
  }

  console.log('Seed complete:', counts)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
