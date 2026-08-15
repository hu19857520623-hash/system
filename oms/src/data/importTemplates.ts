import type {
  DeliveryMethod,
  InboundLineItem,
  InboundOrder,
  InboundType,
  OutboundLineItem,
  PlatformSkuMapping,
  Product,
  StockSource,
  StoreAccount,
} from './mockData'
import { findProductByCode } from './platformBindingUtils'
import type { ReturnLineItem } from './returnStore'
import { RETURN_PROCESS_OPTIONS, RETURN_WAREHOUSE_OPTIONS } from './returnStore'
import { getCustomerSkuDisplay } from './skuCode'
import type { CsvColumn } from './csvImportExport'
import { columnHeader, downloadCsv, downloadTemplate } from './csvImportExport'

export type ParseResult<T> = { data: T[]; errors: string[] }

// ─── 出库明细（与 Outbound.tsx 手动「增加」行一致） ───

export const OUTBOUND_LINE_COLUMNS: CsvColumn[] = [
  { key: 'sku', header: 'SKU', required: true, hint: '仓库 SKU' },
  { key: 'qty', header: '数量', required: true, hint: '大于 0 的整数' },
  { key: 'declaredName', header: '申报品名', required: false, hint: '默认取商品英文申报名' },
  { key: 'declaredValue', header: '申报价值', required: false, hint: '数字，默认取商品申报价' },
  { key: 'note', header: '备注', required: false },
]

export function downloadOutboundLineTemplate() {
  downloadTemplate('OMS-出库明细导入模板.xls', OUTBOUND_LINE_COLUMNS, [
    ['HX6', '10', 'Bluetooth Earbuds', '299.00', ''],
    ['HX7', '5', '', '', '加急'],
  ])
}

export function parseOutboundLines(records: Record<string, string>[]): ParseResult<OutboundLineItem & { id: string }> {
  const data: (OutboundLineItem & { id: string })[] = []
  const errors: string[] = []

  records.forEach((row, idx) => {
    const qty = Number(row.qty)
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push(`第 ${idx + 1} 行：数量须大于 0`)
      return
    }
    const prod = findProductByCode(row.sku)
    const declaredValue = row.declaredValue ? Number(row.declaredValue) : (prod?.price ?? 0)
    if (row.declaredValue && !Number.isFinite(declaredValue)) {
      errors.push(`第 ${idx + 1} 行：申报价值格式不正确`)
      return
    }
    data.push({
      id: `${Date.now()}-${idx}`,
      sku: row.sku,
      name: prod?.name ?? row.sku,
      qty,
      declaredName: row.declaredName || prod?.declaredNameEn || row.sku,
      declaredValue: declaredValue || undefined,
      note: row.note || undefined,
    })
  })

  return { data, errors }
}

// ─── 入库明细（与 Inbound.tsx 手动「增加」行一致） ───

export const INBOUND_LINE_COLUMNS: CsvColumn[] = [
  { key: 'sku', header: 'SKU', required: true, hint: '仓库 SKU' },
  { key: 'qty', header: '数量', required: true, hint: '大于 0 的整数' },
  { key: 'boxNo', header: '箱号', required: false, hint: '默认按行序递增' },
  { key: 'packType', header: '包装类型', required: false, hint: '自带包装 / 仓库包装' },
  { key: 'stockType', header: '箱库存类型', required: false, hint: '以仓库为准 / 以箱为准' },
]

export function downloadInboundLineTemplate() {
  downloadTemplate('OMS-入库明细导入模板.xls', INBOUND_LINE_COLUMNS, [
    ['HX6', '100', '1', '自带包装', '以仓库为准'],
    ['HX7', '50', '2', '自带包装', '以仓库为准'],
  ])
}

export function parseInboundLines(records: Record<string, string>[]): ParseResult<InboundLineItem & { id: string }> {
  const data: (InboundLineItem & { id: string })[] = []
  const errors: string[] = []

  records.forEach((row, idx) => {
    const qty = Number(row.qty)
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push(`第 ${idx + 1} 行：数量须大于 0`)
      return
    }
    const prod = findProductByCode(row.sku)
    const packType = row.packType || '自带包装'
    if (!['自带包装', '仓库包装'].includes(packType)) {
      errors.push(`第 ${idx + 1} 行：包装类型须为「自带包装」或「仓库包装」`)
      return
    }
    const stockType = row.stockType || '以仓库为准'
    if (!['以仓库为准', '以箱为准'].includes(stockType)) {
      errors.push(`第 ${idx + 1} 行：箱库存类型须为「以仓库为准」或「以箱为准」`)
      return
    }
    data.push({
      id: `${Date.now()}-${idx}`,
      sku: row.sku,
      name: prod?.name ?? row.sku,
      qty,
      boxNo: Number(row.boxNo) || idx + 1,
      packType,
      stockType,
    })
  })

  return { data, errors }
}

// ─── 入库预约单批量导入（与 Inbound.tsx 表单头 + 明细一致） ───

export const INBOUND_ORDER_COLUMNS: CsvColumn[] = [
  { key: 'inboundType', header: '入库类型', required: true, hint: '自发头程 / 中转入库 / 退货入库 / 货盘入库' },
  { key: 'delivery', header: '交货方式', required: true, hint: '自送 / 揽收' },
  { key: 'eta', header: '预计到达时间', required: false, hint: 'YYYY-MM-DD' },
  { key: 'trackingNo', header: '跟踪号/提单号', required: false },
  { key: 'referenceNo', header: '参考号', required: false },
  { key: 'platformRef', header: '平台参考号', required: false },
  { key: 'remark', header: '备注', required: false },
  { key: 'sku', header: 'SKU', required: true, hint: '仓库 SKU' },
  { key: 'qty', header: '数量', required: true, hint: '大于 0 的整数' },
  { key: 'boxNo', header: '箱号', required: false, hint: '默认按行序递增' },
  { key: 'packType', header: '包装类型', required: false, hint: '自带包装 / 仓库包装' },
  { key: 'stockType', header: '箱库存类型', required: false, hint: '以仓库为准 / 以箱为准' },
]

const INBOUND_TYPES: InboundType[] = ['自发头程', '中转入库', '退货入库', '货盘入库']

function parseDeliveryMethod(value: string): DeliveryMethod | null {
  if (value === '自送' || value === 'self') return 'self'
  if (value === '揽收' || value === 'pickup') return 'pickup'
  return null
}

export function downloadInboundOrderTemplate() {
  downloadTemplate('OMS-入库预约单导入模板.xls', INBOUND_ORDER_COLUMNS, [
    ['自发头程', '自送', '2026-08-10', 'TRK-001', 'REF-CUS-001', '', '首批到货', 'HX6', '100', '1', '自带包装', '以仓库为准'],
    ['自发头程', '自送', '2026-08-10', 'TRK-001', 'REF-CUS-001', '', '首批到货', 'HX7', '50', '2', '自带包装', '以仓库为准'],
  ])
}

export interface ParsedInboundImport {
  headerKey: string
  inboundType: InboundType
  deliveryMethod: DeliveryMethod
  eta?: string
  trackingNo?: string
  referenceNo?: string
  platformRef?: string
  remark?: string
  lines: InboundLineItem[]
}

export function parseInboundOrders(records: Record<string, string>[]): ParseResult<ParsedInboundImport> {
  const groups = new Map<string, ParsedInboundImport>()
  const errors: string[] = []

  records.forEach((row, idx) => {
    if (!INBOUND_TYPES.includes(row.inboundType as InboundType)) {
      errors.push(`第 ${idx + 1} 行：入库类型无效`)
      return
    }
    const deliveryMethod = parseDeliveryMethod(row.delivery)
    if (!deliveryMethod) {
      errors.push(`第 ${idx + 1} 行：交货方式须为「自送」或「揽收」`)
      return
    }
    const qty = Number(row.qty)
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push(`第 ${idx + 1} 行：数量须大于 0`)
      return
    }

    const headerKey = [
      row.inboundType,
      row.delivery,
      row.eta,
      row.trackingNo,
      row.referenceNo,
      row.platformRef,
      row.remark,
    ].join('|')

    if (!groups.has(headerKey)) {
      groups.set(headerKey, {
        headerKey,
        inboundType: row.inboundType as InboundType,
        deliveryMethod,
        eta: row.eta || undefined,
        trackingNo: row.trackingNo || undefined,
        referenceNo: row.referenceNo || undefined,
        platformRef: row.platformRef || undefined,
        remark: row.remark || undefined,
        lines: [],
      })
    }

    const prod = findProductByCode(row.sku)
    const packType = row.packType || '自带包装'
    const stockType = row.stockType || '以仓库为准'
    groups.get(headerKey)!.lines.push({
      sku: row.sku,
      name: prod?.name ?? row.sku,
      qty,
      boxNo: Number(row.boxNo) || groups.get(headerKey)!.lines.length + 1,
      packType,
      stockType,
    })
  })

  return { data: [...groups.values()], errors }
}

export function exportInboundOrders(orders: InboundOrder[]) {
  const rows = [INBOUND_ORDER_COLUMNS.map(columnHeader)]
  for (const order of orders) {
    const lines = order.lineItems?.length
      ? order.lineItems
      : [{ sku: order.skuHint ?? '', name: '', qty: order.totalQty, boxNo: 1, packType: '自带包装', stockType: '以仓库为准' }]
    for (const line of lines) {
      rows.push([
        order.inboundType,
        order.deliveryMethod === 'pickup' ? '揽收' : '自送',
        order.eta ?? '',
        order.trackingNo ?? '',
        order.referenceNo ?? '',
        '',
        order.remark ?? '',
        line.sku,
        String(line.qty),
        String(line.boxNo ?? ''),
        line.packType ?? '自带包装',
        line.stockType ?? '以仓库为准',
      ])
    }
  }
  downloadCsv('OMS-入库记录导出.csv', rows)
}

// ─── 平台绑定（与 PlatformBindingModal 一致，同条码多行=组合品） ───

export const PLATFORM_BINDING_COLUMNS: CsvColumn[] = [
  { key: 'platform', header: '平台名称', required: true, hint: 'Takealot / Shopify / Manual' },
  { key: 'storeName', header: '平台店铺', required: true, hint: '店铺名称或店铺编码' },
  { key: 'platformBarcode', header: '平台商品条码', required: true, hint: '990 条码' },
  { key: 'platformTitle', header: '平台商品名称', required: false },
  { key: 'stockSource', header: '库存来源', required: true, hint: '自有库存 / 货盘库存' },
  { key: 'internalSku', header: '仓库商品编码', required: true, hint: '内部 SKU' },
  { key: 'warehouseName', header: '仓库商品名称', required: false, hint: '默认取商品名' },
  { key: 'shortName', header: '仓库商品简称', required: false },
  { key: 'packType', header: '仓库商品包装', required: false, hint: '自带包装 / 仓库包装' },
  { key: 'lineQty', header: '仓库商品数量', required: true, hint: '组合品对应数量，默认 1' },
]

function parseStockSource(value: string): StockSource | null {
  if (value === '自有库存' || value === 'owned') return 'owned'
  if (value === '货盘库存' || value === 'catalog') return 'catalog'
  return null
}

export function downloadPlatformBindingTemplate() {
  downloadTemplate('OMS-平台绑定导入模板.xls', PLATFORM_BINDING_COLUMNS, [
    ['Takealot', '主店', '6009637110200', 'Wireless Mouse', '自有库存', 'HX6', 'Ergonomic Mouse', '', '自带包装', '1'],
  ])
}

export interface ParsedPlatformBinding {
  platform: PlatformSkuMapping['platform']
  storeId: string
  storeName: string
  platformBarcode: string
  platformTitle: string
  stockSource: StockSource
  lines: PlatformSkuMapping['lines']
}

export function parsePlatformBindings(
  records: Record<string, string>[],
  stores: StoreAccount[],
): ParseResult<ParsedPlatformBinding> {
  const groups = new Map<string, ParsedPlatformBinding>()
  const errors: string[] = []

  records.forEach((row, idx) => {
    const platform = row.platform as PlatformSkuMapping['platform']
    if (!['Takealot', 'Shopify', 'Manual'].includes(platform)) {
      errors.push(`第 ${idx + 1} 行：平台名称无效`)
      return
    }
    const store = stores.find(
      s => s.name === row.storeName || s.storeCode === row.storeName,
    )
    if (!store) {
      errors.push(`第 ${idx + 1} 行：未找到店铺「${row.storeName}」`)
      return
    }
    const stockSource = parseStockSource(row.stockSource)
    if (!stockSource) {
      errors.push(`第 ${idx + 1} 行：库存来源须为「自有库存」或「货盘库存」`)
      return
    }
    const lineQty = Number(row.lineQty || '1')
    if (!Number.isFinite(lineQty) || lineQty <= 0) {
      errors.push(`第 ${idx + 1} 行：仓库商品数量须大于 0`)
      return
    }

    const key = `${platform}|${store.id}|${row.platformBarcode}|${stockSource}`
    const prod = findProductByCode(row.internalSku)
    const line = {
      internalSku: row.internalSku,
      warehouseName: row.warehouseName || prod?.name || row.internalSku,
      shortName: row.shortName || undefined,
      packType: row.packType || '自带包装',
      qty: lineQty,
    }

    if (!groups.has(key)) {
      groups.set(key, {
        platform,
        storeId: store.id,
        storeName: store.name,
        platformBarcode: row.platformBarcode,
        platformTitle: row.platformTitle || prod?.name || row.platformBarcode,
        stockSource,
        lines: [line],
      })
    } else {
      groups.get(key)!.lines.push(line)
    }
  })

  return { data: [...groups.values()], errors }
}

// ─── 产品导入（与 ProductForm 核心字段一致） ───

export const PRODUCT_COLUMNS: CsvColumn[] = [
  { key: 'internalSku', header: '产品SKU', required: true, hint: '客户自定义编码，可重复' },
  { key: 'name', header: '产品名称', required: true, hint: '中文名称' },
  { key: 'declaredNameEn', header: '产品名称EN', required: true, hint: '英文名称' },
  { key: 'customCode', header: '自定义编号', required: false },
  { key: 'declaredValue', header: '申报价值', required: true, hint: '人民币，数字' },
  { key: 'declaredNameCn', header: '中文申报品名', required: true, hint: '报关中文品名' },
  { key: 'declaredNameEnDecl', header: '英文申报品名', required: true, hint: '报关英文品名' },
  { key: 'unit', header: '产品单位', required: true, hint: 'PCS / SET / BOX' },
  { key: 'weightKg', header: '产品重量KG', required: true, hint: '0.001-9999.999' },
  { key: 'lengthCm', header: '长CM', required: true, hint: '外包装长度' },
  { key: 'widthCm', header: '宽CM', required: true, hint: '外包装宽度' },
  { key: 'heightCm', header: '高CM', required: true, hint: '外包装高度' },
  { key: 'hasBattery', header: '含电池', required: false, hint: '是 / 否' },
]

export function downloadProductTemplate() {
  downloadTemplate('OMS-产品导入模板.xls', PRODUCT_COLUMNS, [
    ['HX6', '蓝牙耳机 Pro', 'Bluetooth Earbuds Pro', 'CUS-HX6', '299', '蓝牙耳机', 'Bluetooth Earbuds', 'PCS', '0.35', '18', '12', '8', '否'],
  ])
}

export function parseProducts(records: Record<string, string>[], customerId?: string): ParseResult<Product> {
  const data: Product[] = []
  const errors: string[] = []

  records.forEach((row, idx) => {
    const customerSku = row.internalSku.trim()
    if (!customerSku) {
      errors.push(`第 ${idx + 1} 行：产品SKU 不能为空`)
      return
    }

    const weightKg = Number(row.weightKg)
    const lengthCm = Number(row.lengthCm)
    const widthCm = Number(row.widthCm)
    const heightCm = Number(row.heightCm)
    const declaredValue = Number(row.declaredValue)
    if ([weightKg, lengthCm, widthCm, heightCm, declaredValue].some(v => !Number.isFinite(v) || v <= 0)) {
      errors.push(`第 ${idx + 1} 行：申报价值与重量/尺寸须为大于 0 的数字`)
      return
    }

    data.push({
      id: `prod-import-${Date.now()}-${idx}`,
      customerId,
      customerSku,
      internalSku: customerSku,
      name: row.name,
      spec: `${lengthCm}×${widthCm}×${heightCm} cm`,
      image: '',
      price: declaredValue,
      cost: 0,
      availableQty: 0,
      lockedQty: 0,
      customCode: row.customCode || undefined,
      category: '',
      categoryPath: '',
      weight: `${weightKg} kg`,
      weightKg,
      lengthCm,
      widthCm,
      heightCm,
      inCatalog: false,
      productStatus: 'reviewing',
      productSource: 'import',
      hasBattery: row.hasBattery === '是' || row.hasBattery === 'yes',
      certUploaded: false,
      hasBoxSpec: false,
      declaredNameEn: row.declaredNameEnDecl || row.declaredNameEn,
      declaredNameCn: row.declaredNameCn,
      declaredValue,
      unit: row.unit || 'PCS',
    })
  })

  return { data, errors }
}

// ─── 退件明细（与 ReturnApply.tsx 手动「添加」行一致） ───

export const RETURN_LINE_COLUMNS: CsvColumn[] = [
  { key: 'sku', header: 'SKU', required: true, hint: '仓库 SKU' },
  { key: 'qty', header: '数量', required: true, hint: '大于 0 的整数' },
]

export function downloadReturnLineTemplate() {
  downloadTemplate('OMS-退件明细导入模板.xls', RETURN_LINE_COLUMNS, [
    ['HX6', '10'],
    ['HX7', '5'],
  ])
}

export function parseReturnLines(records: Record<string, string>[]): ParseResult<ReturnLineItem & { id: string }> {
  const data: (ReturnLineItem & { id: string })[] = []
  const errors: string[] = []

  records.forEach((row, idx) => {
    const qty = Number(row.qty)
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push(`第 ${idx + 1} 行：数量须大于 0`)
      return
    }
    const prod = findProductByCode(row.sku)
    data.push({
      id: `${Date.now()}-${idx}`,
      sku: row.sku,
      name: prod?.name ?? row.sku,
      qty,
    })
  })

  return { data, errors }
}

// ─── 退件预约单批量导入（与 ReturnApply.tsx 表单头 + 明细一致） ───

export const RETURN_ORDER_COLUMNS: CsvColumn[] = [
  { key: 'orderNo', header: '订单号', required: true },
  { key: 'referenceNo', header: '参考号', required: false },
  { key: 'trackingNo', header: '跟踪号', required: false },
  { key: 'sellerStoreName', header: '卖家店铺名称', required: false },
  { key: 'sellerTaxNo', header: '卖家税号', required: false },
  { key: 'returnWarehouse', header: '退件仓库', required: true, hint: 'JHB3 / CPT2 / DBN' },
  { key: 'expectedArrivalAt', header: '预计到货时间', required: false, hint: 'YYYY-MM-DD 或 YYYY-MM-DD HH:mm' },
  { key: 'returnReason', header: '退件原因', required: true, hint: '客户拒收 / 包装破损 / 发错商品 / 质量问题 / 平台退货 / 其他' },
  { key: 'requestedProcess', header: '处理方式', required: true, hint: '检查拍照 / 直接上架 / 换标上架 / 等问题' },
  { key: 'returnDescription', header: '退件说明', required: false },
  { key: 'remark', header: '备注', required: false },
  { key: 'sku', header: 'SKU', required: true, hint: '仓库 SKU' },
  { key: 'qty', header: '数量', required: true, hint: '大于 0 的整数' },
]

const RETURN_WAREHOUSE_VALUES = RETURN_WAREHOUSE_OPTIONS.map(w => w.value) as readonly string[]

function parseReturnWarehouse(value: string): (typeof RETURN_WAREHOUSE_OPTIONS[number]['value']) | null {
  const v = value.trim().toUpperCase()
  if ((RETURN_WAREHOUSE_VALUES as readonly string[]).includes(v)) {
    return v as (typeof RETURN_WAREHOUSE_OPTIONS[number]['value'])
  }
  const byLabel = RETURN_WAREHOUSE_OPTIONS.find(w => w.label.toUpperCase() === v)
  return byLabel?.value ?? null
}

function parseReturnProcess(value: string): string | null {
  const v = value.trim()
  const byValue = RETURN_PROCESS_OPTIONS.find(o => o.value === v)
  if (byValue) return byValue.value
  const byLabel = RETURN_PROCESS_OPTIONS.find(o => o.label === v)
  return byLabel?.value ?? null
}

function normalizeExpectedArrival(value: string): string | undefined {
  const v = value.trim()
  if (!v) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v} 00:00`
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v)) return v.replace('T', ' ').slice(0, 16)
  return v
}

export interface ParsedReturnImport {
  headerKey: string
  orderNo: string
  referenceNo?: string
  trackingNo?: string
  sellerStoreName?: string
  sellerTaxNo?: string
  returnWarehouse: string
  expectedArrivalAt?: string
  returnReason: string
  requestedProcess: string
  returnDescription?: string
  remark?: string
  lineItems: ReturnLineItem[]
}

export function downloadReturnOrderTemplate() {
  downloadTemplate('OMS-退件预约单导入模板.xls', RETURN_ORDER_COLUMNS, [
    ['ORD-20260810-001', 'REF-001', 'TRK-001', 'Takealot 主店', '', 'JHB3', '2026-08-15', '平台退货', '检查拍照', '外包装完好', '', 'HX6', '10'],
    ['ORD-20260810-001', 'REF-001', 'TRK-001', 'Takealot 主店', '', 'JHB3', '2026-08-15', '平台退货', '检查拍照', '外包装完好', '', 'HX7', '5'],
  ])
}

export function parseReturnOrders(records: Record<string, string>[]): ParseResult<ParsedReturnImport> {
  const groups = new Map<string, ParsedReturnImport>()
  const errors: string[] = []

  records.forEach((row, idx) => {
    const returnWarehouse = parseReturnWarehouse(row.returnWarehouse)
    if (!returnWarehouse) {
      errors.push(`第 ${idx + 1} 行：退件仓库须为 ${RETURN_WAREHOUSE_VALUES.join(' / ')}`)
      return
    }
    const requestedProcess = parseReturnProcess(row.requestedProcess)
    if (!requestedProcess) {
      errors.push(`第 ${idx + 1} 行：处理方式无效（如：检查拍照、直接上架、换标上架、等问题）`)
      return
    }
    const qty = Number(row.qty)
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push(`第 ${idx + 1} 行：数量须大于 0`)
      return
    }

    const headerKey = [
      row.orderNo,
      row.referenceNo,
      row.trackingNo,
      row.sellerStoreName,
      row.sellerTaxNo,
      returnWarehouse,
      row.expectedArrivalAt,
      row.returnReason,
      requestedProcess,
      row.returnDescription,
      row.remark,
    ].join('|')

    if (!groups.has(headerKey)) {
      groups.set(headerKey, {
        headerKey,
        orderNo: row.orderNo,
        referenceNo: row.referenceNo || undefined,
        trackingNo: row.trackingNo || undefined,
        sellerStoreName: row.sellerStoreName || undefined,
        sellerTaxNo: row.sellerTaxNo || undefined,
        returnWarehouse,
        expectedArrivalAt: normalizeExpectedArrival(row.expectedArrivalAt),
        returnReason: row.returnReason,
        requestedProcess,
        returnDescription: row.returnDescription || undefined,
        remark: row.remark || undefined,
        lineItems: [],
      })
    }

    const prod = findProductByCode(row.sku)
    groups.get(headerKey)!.lineItems.push({
      sku: row.sku,
      name: prod?.name ?? row.sku,
      qty,
    })
  })

  return { data: [...groups.values()], errors }
}

export function exportProducts(products: Product[]) {
  const rows = [PRODUCT_COLUMNS.map(columnHeader)]
  for (const p of products) {
    rows.push([
      p.customerSku || getCustomerSkuDisplay(p),
      p.name,
      p.declaredNameEn,
      p.customCode ?? '',
      String(p.declaredValue),
      p.declaredNameCn,
      p.declaredNameEn,
      p.unit,
      String(p.weightKg),
      String(p.lengthCm),
      String(p.widthCm),
      String(p.heightCm),
      p.hasBattery ? '是' : '否',
    ])
  }
  downloadCsv('OMS-产品导出.csv', rows)
}
