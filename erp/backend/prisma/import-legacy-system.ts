/**
 * 将旧系统导出的供应商、产品、发货汇总和采购单导入 ERP。
 * 默认只校验；传入 --apply 后执行可重复的 upsert。
 *
 * 用法：npx ts-node prisma/import-legacy-system.ts [--apply]
 */
import * as XLSX from 'xlsx'
import { PrismaClient, type Prisma } from '@prisma/client'

const SUPPLIER_FILES = ['D:/供应商导出.xlsx', 'D:/供应商导出1.xlsx', 'D:/供应商导出2.xlsx']
const PRODUCT_FILE = 'D:/产品＋图片.xls'
const SHIPMENT_FILE = 'D:/发货总会.xls'
const PURCHASE_FILE = 'C:/Users/15693/Desktop/采购单.xls'
const APPLY = process.argv.includes('--apply')

type LegacyRow = Record<string, unknown>

const text = (value: unknown) => String(value ?? '').trim()
const trunc = (value: unknown, max: number) => text(value).slice(0, max)
const optional = (value: unknown, max?: number) => {
  const result = max ? trunc(value, max) : text(value)
  return result || undefined
}
const number = (value: unknown, fallback = 0) => {
  const parsed = Number(text(value).replace(/,/g, '').replace(/%$/, ''))
  return Number.isFinite(parsed) ? parsed : fallback
}
const integer = (value: unknown, fallback = 0) => Math.max(0, Math.trunc(number(value, fallback)))
const date = (value: unknown) => {
  const raw = text(value)
  if (!raw || raw.startsWith('0000-00-00')) return undefined
  const parsed = new Date(raw.replace(' ', 'T'))
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function sheetRows(file: string, preferredSheet?: string): LegacyRow[] {
  const workbook = XLSX.readFile(file, { cellDates: true })
  const sheetName = preferredSheet && workbook.Sheets[preferredSheet] ? preferredSheet : workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error(`${file} 中没有可读取的工作表`)
  return XLSX.utils.sheet_to_json<LegacyRow>(sheet, { defval: '', raw: false })
}

function supplierReference(value: unknown) {
  const raw = text(value)
  const match = raw.match(/^(.+?)\[([^\]]+)]$/)
  return match ? { code: trunc(match[1], 30), name: trunc(match[2], 200) } : null
}

function productStatus(value: unknown) {
  const status = text(value)
  return status.includes('下架') || status.includes('清货') || status.includes('停售') ? 'inactive' : 'active'
}

function category(row: LegacyRow) {
  const value = ['一级品类', '二级品类', '三级品类'].map((key) => text(row[key])).filter(Boolean).join(' / ')
  return optional(value, 50)
}

function remark(parts: Array<string | undefined>) {
  const value = parts.filter(Boolean).join(' | ')
  return value || undefined
}

function groupPurchaseRows(rows: LegacyRow[]) {
  const groups = new Map<string, LegacyRow[]>()
  let current = ''
  for (const row of rows) {
    if (text(row['采购单号'])) current = trunc(row['采购单号'], 30)
    if (!current || !text(row['产品编码'])) continue
    if (!groups.has(current)) groups.set(current, [])
    groups.get(current)!.push(row)
  }
  return groups
}

async function main() {
  const supplierRows = SUPPLIER_FILES.flatMap((file) => sheetRows(file, '产品信息'))
  const contactRows = SUPPLIER_FILES.flatMap((file) => {
    const workbook = XLSX.readFile(file, { cellDates: true })
    const sheet = workbook.Sheets['联系信息']
    return sheet ? XLSX.utils.sheet_to_json<LegacyRow>(sheet, { defval: '', raw: false }) : []
  })
  const productRows = sheetRows(PRODUCT_FILE)
  const shipmentRows = sheetRows(SHIPMENT_FILE)
  const purchaseGroups = groupPurchaseRows(sheetRows(PURCHASE_FILE, 'Worksheet 1'))

  const supplierCodes = supplierRows.map((row) => trunc(row['供应商代码'], 30))
  const productSkus = productRows.map((row) => trunc(row['产品SKU'], 30))
  const duplicates = (values: string[]) => values.filter((value, index) => value && values.indexOf(value) !== index)
  const failures = [
    ...supplierRows.filter((row) => !text(row['供应商代码']) || !text(row['供应商名称'])).map(() => '供应商缺少代码或名称'),
    ...productRows.filter((row) => !text(row['产品SKU']) || !text(row['产品名称'])).map(() => '产品缺少 SKU 或名称'),
    ...shipmentRows.filter((row) => !text(row['系统订单号'])).map(() => '发货记录缺少系统订单号'),
    ...duplicates(supplierCodes).map((value) => `供应商代码重复：${value}`),
    ...duplicates(productSkus).map((value) => `产品 SKU 重复：${value}`),
  ]
  if (failures.length) throw new Error(`源文件校验失败：\n${failures.join('\n')}`)

  console.log(`校验完成：供应商 ${supplierRows.length}，产品 ${productRows.length}，发货 ${shipmentRows.length}，采购单 ${purchaseGroups.size}`)
  if (!APPLY) {
    console.log('当前为校验模式；传入 --apply 执行导入。')
    return
  }

  const prisma = new PrismaClient()
  const counters = {
    suppliersCreated: 0,
    suppliersUpdated: 0,
    productsCreated: 0,
    productsUpdated: 0,
    shipmentsCreated: 0,
    shipmentsUpdated: 0,
    purchasesCreated: 0,
    purchasesUpdated: 0,
    purchaseItems: 0,
  }

  try {
    const contacts = new Map(contactRows.map((row) => [trunc(row['供应商代码'], 30), row]))
    const supplierByCode = new Map<string, bigint>()

    for (const row of supplierRows) {
      const code = trunc(row['供应商代码'], 30)
      const contact = contacts.get(code)
      const data: Prisma.SupplierUncheckedCreateInput = {
        supplierCode: code,
        supplierName: trunc(row['供应商名称'], 200),
        contactName: optional(contact?.['联系人'], 50),
        contactPhone: optional(contact?.['联系电话'], 30),
        address: optional(contact?.['中文联系地址'], 500),
        country: 'China',
        paymentTerms: trunc(
          [text(row['供应商结算方式']), text(row['支付周期类型']), text(row['支付方式'])].filter(Boolean).join(' / ') || '现结',
          100,
        ),
        rating: integer(row['供应商等级'], 3) || 3,
        status: text(row['状态']).includes('停') ? 0 : 1,
        remark: remark([
          optional(row['供应商类型']) && `供应商类型:${text(row['供应商类型'])}`,
          optional(row['合作类型']) && `合作类型:${text(row['合作类型'])}`,
          optional(row['主营品类']) && `主营品类:${text(row['主营品类'])}`,
          optional(row['采购员']) && `旧系统采购员:${text(row['采购员'])}`,
          '来源:旧系统供应商导出',
        ]),
        createdAt: date(row['创建时间']),
      }
      const existing = await prisma.supplier.findUnique({ where: { supplierCode: code } })
      const saved = existing
        ? await prisma.supplier.update({ where: { supplierCode: code }, data })
        : await prisma.supplier.create({ data })
      existing ? counters.suppliersUpdated++ : counters.suppliersCreated++
      supplierByCode.set(code, saved.id)
    }

    const users = await prisma.sysUser.findMany({ select: { id: true, username: true, realName: true } })
    const resolveUser = (value: unknown) => {
      const key = text(value)
      return users.find((user) => user.username === key || user.realName === key)?.id
    }

    for (const row of productRows) {
      const sku = trunc(row['产品SKU'], 30)
      const supplier = supplierReference(row['供应商'])
      let supplierId = supplier?.code ? supplierByCode.get(supplier.code) : undefined
      if (supplier && !supplierId) {
        const saved = await prisma.supplier.upsert({
          where: { supplierCode: supplier.code },
          create: { supplierCode: supplier.code, supplierName: supplier.name, paymentTerms: '现结', status: 1, remark: '来源:旧系统产品导出' },
          update: { supplierName: supplier.name },
        })
        supplierId = saved.id
        supplierByCode.set(supplier.code, saved.id)
      }
      const salesStatus = text(row['销售状态'])
      const imageUrl = optional(text(row['图片URL']).split(',')[0], 500)
      const productData: Prisma.ProductUncheckedCreateInput = {
        sku,
        spu: optional(row['主型号'], 30),
        productName: trunc(row['产品名称'], 300),
        spec: optional(row['规格'], 100),
        category: category(row),
        brand: optional(row['品牌'], 50),
        lengthCm: number(row['包装尺寸-长(cm)']) || undefined,
        widthCm: number(row['包装尺寸-宽(cm)']) || undefined,
        heightCm: number(row['包装尺寸-高(cm)']) || undefined,
        measuredLengthCm: number(row['净尺寸-长(cm)']) || undefined,
        measuredWidthCm: number(row['净尺寸-宽(cm)']) || undefined,
        measuredHeightCm: number(row['净尺寸-高(cm)']) || undefined,
        weightKg: number(row['重量']) || undefined,
        costRmb: number(row['最近单价(RMB)']) || number(row['采购价']) || number(row['采购参考价']) || undefined,
        barcode: optional(row['EAN码'], 50) || optional(row['UPC'], 50),
        declaredNameCn: optional(row['海关中文品名'], 300),
        declaredNameEn: optional(row['海关英文品名'], 300),
        unit: optional(row['单位'], 20),
        hasBattery: ['是', 'yes', 'true', '1'].includes(text(row['是否包含电池']).toLowerCase()),
        imageUrl,
        developerId: resolveUser(row['开发负责人']),
        purchaserId: resolveUser(row['默认采购员']),
        supplierId,
        status: productStatus(salesStatus),
        syncStatus: 'pending',
        remark: remark([
          salesStatus && `销售状态:${salesStatus}`,
          optional(row['运营方式']) && `运营方式:${text(row['运营方式'])}`,
          optional(row['商品ID']) && `旧商品ID:${text(row['商品ID'])}`,
          optional(row['默认采购员']) && `旧采购员:${text(row['默认采购员'])}`,
          optional(row['开发负责人']) && `旧开发负责人:${text(row['开发负责人'])}`,
          '来源:旧系统产品导出',
        ]),
      }
      const existing = await prisma.product.findUnique({ where: { sku } })
      const saved = existing
        ? await prisma.product.update({ where: { sku }, data: productData })
        : await prisma.product.create({ data: productData })
      existing ? counters.productsUpdated++ : counters.productsCreated++
      if (imageUrl) {
        const imageExists = await prisma.productImage.findFirst({ where: { productId: saved.id, imageUrl } })
        if (!imageExists) await prisma.productImage.create({ data: { productId: saved.id, imageUrl, sortOrder: 0 } })
      }
    }

    for (const row of shipmentRows) {
      const outboundNo = trunc(row['系统订单号'], 30)
      const received = text(row['收货状态']) === '已收货'
      const payload: Prisma.OutboundOrderUncheckedCreateInput = {
        outboundNo,
        warehouseCode: 'WMS-JHB-01',
        destType: 'overseas',
        trackingNo: optional(row['跟踪号'], 50),
        logisticsProduct: optional(row['运输方式名称'], 50),
        batchNo: optional(row['头程计划单'], 50),
        status: received ? 'delivered' : 'shipped',
        shippedAt: date(row['出库时间']) || date(row['日期']),
        remark: remark([
          `旧系统目的仓库:${text(row['目的仓库'])}`,
          `收货状态:${text(row['收货状态'])}`,
          `箱数:${integer(row['数量(箱)'])}`,
          `SKU品种:${integer(row['SKU的总品种'])}`,
          `SKU总数量:${integer(row['SKU的总数量'])}`,
          `金额RMB:${number(row['金额(汇总)RMB']) || number(row['金额(RMB)'])}`,
          `体积m³:${number(row['实际总体积(m³)'])}`,
          `重量KG:${number(row['重量KG'])}`,
          optional(row['柜号']) && `柜号:${text(row['柜号'])}`,
          optional(row['入库单']) && `旧入库单:${text(row['入库单'])}`,
          optional(row['备注']) && `备注:${text(row['备注'])}`,
          '来源:旧系统发货总会',
        ]),
        createdAt: date(row['头程单创建时间']) || date(row['日期']),
      }
      const existing = await prisma.outboundOrder.findUnique({ where: { outboundNo } })
      existing
        ? await prisma.outboundOrder.update({ where: { outboundNo }, data: payload })
        : await prisma.outboundOrder.create({ data: payload })
      existing ? counters.shipmentsUpdated++ : counters.shipmentsCreated++
    }

    for (const [poNo, rows] of purchaseGroups) {
      const header = rows[0]
      const supplierCode = trunc(header['供应商编码'], 30)
      let supplierId = supplierByCode.get(supplierCode)
      if (!supplierId) {
        const saved = await prisma.supplier.upsert({
          where: { supplierCode },
          create: { supplierCode, supplierName: trunc(header['供应商名称'], 200), paymentTerms: trunc(header['结算方式'], 100) || '现结' },
          update: { supplierName: trunc(header['供应商名称'], 200) },
        })
        supplierId = saved.id
        supplierByCode.set(supplierCode, saved.id)
      }
      const itemTotal = rows.reduce((sum, row) => sum + number(row['总价(含税)']), 0)
      const orderTotal = number(header['商品金额(含税)']) || itemTotal
      const sourceStatus = text(header['采购单状态'])
      const status = sourceStatus === '已完成' ? 'completed' : sourceStatus.includes('审批') ? 'finance_approved' : 'draft'
      const orderData: Prisma.PurchaseOrderUncheckedCreateInput = {
        poNo,
        supplierId,
        warehouseCode: null,
        totalAmount: orderTotal,
        domesticFreight: number(header['采购单运费']) || undefined,
        currency: trunc(header['币种'], 10) || 'RMB',
        expectedArrival: date(header['采购单预计到货时间']),
        status,
        purchaserId: resolveUser(header['采购员']),
        auditorId: resolveUser(header['审批人']),
        auditedAt: date(header['审核时间']),
        paymentStatus: text(header['付款状态']).includes('已付款') ? 'paid' : 'unpaid',
        remark: remark([
          `旧采购仓:${text(header['采购仓代码'])}/${text(header['采购仓名称'])}`,
          `旧状态:${sourceStatus}`,
          `旧付款状态:${text(header['付款状态'])}`,
          optional(header['入库单号']) && `旧入库单:${text(header['入库单号'])}`,
          optional(header['供应商运输方式']) && `运输方式:${text(header['供应商运输方式'])}`,
          optional(header['补货方式']) && `补货方式:${text(header['补货方式'])}`,
          optional(header['创建人']) && `旧创建人:${text(header['创建人'])}`,
          optional(header['采购员']) && `旧采购员:${text(header['采购员'])}`,
          '来源:旧系统采购单导出',
        ]),
        createdAt: date(header['创建时间']),
      }
      const existing = await prisma.purchaseOrder.findUnique({ where: { poNo } })
      const order = existing
        ? await prisma.purchaseOrder.update({ where: { poNo }, data: orderData })
        : await prisma.purchaseOrder.create({ data: orderData })
      existing ? counters.purchasesUpdated++ : counters.purchasesCreated++

      await prisma.purchaseOrderItem.deleteMany({ where: { poId: order.id } })
      for (const row of rows) {
        const sku = trunc(row['产品编码'], 30)
        const product = await prisma.product.findUnique({ where: { sku } })
        if (!product) throw new Error(`采购单 ${poNo} 的 SKU ${sku} 未找到产品主数据`)
        const quantity = integer(row['采购确认数量']) || integer(row['预期数量'])
        const unitPrice = number(row['单价(含税)']) || number(row['单价(不含税)'])
        await prisma.purchaseOrderItem.create({
          data: {
            poId: order.id,
            productId: product.id,
            sku,
            productName: trunc(row['产品名称'], 300),
            plannedQty: integer(row['预期数量']),
            quantity,
            unitPrice,
            amount: number(row['总价(含税)']) || unitPrice * quantity,
            domesticFreight: number(row['SKU运费']) || undefined,
            receivedQty: integer(row['实收数量']),
            remark: trunc(
              remark([
                optional(row['产品采购备注']) && `采购备注:${text(row['产品采购备注'])}`,
                `在途:${integer(row['在途'])}`,
                `未到货:${integer(row['未到货数量'])}`,
              ]) || '',
              500,
            ) || undefined,
          },
        })
        counters.purchaseItems++
      }
    }

    console.log(JSON.stringify(counters, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
