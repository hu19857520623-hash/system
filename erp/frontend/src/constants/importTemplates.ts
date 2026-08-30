import { downloadImportTemplate, findCsvColumn, parseCsvLine } from '@/utils/csv'

export interface ImportFieldDef {
  key: string
  label: string
  required: boolean
  hint?: string
}

/** 入库 SKU 明细 — 与 CreateInboundView 手动行字段一致 */
export const INBOUND_SKU_IMPORT_FIELDS: ImportFieldDef[] = [
  { key: 'sku', label: 'SKU', required: true, hint: '须在始发物流仓可发列表中' },
  { key: 'qty', label: '预期入库数量', required: true, hint: '正整数，不超过可发库存' },
  { key: 'length', label: '长(cm)', required: true },
  { key: 'width', label: '宽(cm)', required: true },
  { key: 'height', label: '高(cm)', required: true },
  { key: 'weight', label: '重量(kg)', required: true },
  { key: 'remark', label: '行备注', required: false },
]

export const INBOUND_SKU_IMPORT_HEADERS = INBOUND_SKU_IMPORT_FIELDS.map((f) => f.label)

export const INBOUND_SKU_SAMPLE_ROWS: unknown[][] = [
  ['TK-99001', '100', '30', '20', '15', '0.5', ''],
  ['TK-66105', '50', '25', '18', '10', '0.3', '急单'],
]

export function downloadInboundSkuTemplate() {
  downloadImportTemplate('入库SKU导入模板.xls', INBOUND_SKU_IMPORT_FIELDS, INBOUND_SKU_SAMPLE_ROWS)
}

export function resolveInboundSkuColumns(header: string[]) {
  const cols = header.map((h) => h.trim())
  return {
    skuIdx: findCsvColumn(cols, ['SKU', 'sku', '自定义编码']),
    qtyIdx: findCsvColumn(cols, ['预期入库数量', '数量', '预期数量', 'qty']),
    lengthIdx: findCsvColumn(cols, ['长(cm)', '长', 'lengthcm', 'length']),
    widthIdx: findCsvColumn(cols, ['宽(cm)', '宽', 'widthcm', 'width']),
    heightIdx: findCsvColumn(cols, ['高(cm)', '高', 'heightcm', 'height']),
    weightIdx: findCsvColumn(cols, ['重量(kg)', '重量', 'weightkg', 'weight']),
    remarkIdx: findCsvColumn(cols, ['行备注', '备注', 'remark']),
  }
}

export interface InboundSkuImportRow {
  sku: string
  qty: number
  lengthCm: number
  widthCm: number
  heightCm: number
  weightKg: number
  remark: string
}

/** 校验单行导入数据是否与手动创建必填项一致 */
export function validateInboundSkuImportRow(row: InboundSkuImportRow): string | null {
  if (!row.sku.trim()) return 'SKU 不能为空'
  if (!row.qty || row.qty <= 0) return `${row.sku}：预期入库数量须大于 0`
  if (!row.lengthCm || !row.widthCm || !row.heightCm) return `${row.sku}：长、宽、高（cm）均为必填`
  if (!row.weightKg) return `${row.sku}：重量（kg）为必填`
  return null
}

/** 线索 — 与 LeadsPoolView 新建线索表单字段一致 */
export const LEADS_IMPORT_FIELDS: ImportFieldDef[] = [
  { key: 'leadNo', label: '线索编号', required: false, hint: '留空自动生成' },
  { key: 'company', label: '客户名称', required: true },
  { key: 'contact', label: '联系方式', required: true, hint: '姓名 / 微信 / 手机均可；兼容旧表头「联系人」' },
  { key: 'phone', label: '电话', required: false },
  { key: 'source', label: '来源', required: false, hint: '默认 Takealot' },
  { key: 'assignee', label: '归属运营', required: false, hint: '用户名或姓名；留空则当前登录用户' },
  { key: 'followSales', label: '跟进销售', required: false, hint: '跟进该线索的销售姓名' },
  { key: 'remark', label: '备注', required: false },
]

export const LEADS_IMPORT_HEADERS = LEADS_IMPORT_FIELDS.map((f) => f.label)

export const LEADS_IMPORT_SAMPLE_ROWS: unknown[][] = [
  ['', '示例科技有限公司', '张三', '13800138000', 'Takealot', 'sales01', '陈琪珍', ''],
  ['LD-XHS-0099', '开普敦贸易', '李四', '0821234567', '展会', '', '', '重点客户'],
]

export function downloadLeadsImportTemplate() {
  downloadImportTemplate('线索导入模板.xls', LEADS_IMPORT_FIELDS, LEADS_IMPORT_SAMPLE_ROWS)
}

/** 商品主数据 — 与 ProductsView 创建商品表单字段一致 */
export const PRODUCT_IMPORT_FIELDS: ImportFieldDef[] = [
  { key: 'sku', label: 'SKU', required: true },
  { key: 'spu', label: 'SPU', required: false },
  { key: 'productName', label: '商品名称', required: true },
  { key: 'spec', label: '规格', required: false },
  { key: 'costRmb', label: '采购成本(RMB)', required: false },
  { key: 'lengthCm', label: '长(cm)', required: false },
  { key: 'widthCm', label: '宽(cm)', required: false },
  { key: 'heightCm', label: '高(cm)', required: false },
  { key: 'weightKg', label: '重量(kg)', required: false },
  { key: 'barcode', label: '条码', required: false },
  { key: 'developer', label: '开发人', required: false, hint: '用户名或姓名' },
  { key: 'purchaser', label: '采购员', required: false, hint: '用户名或姓名' },
  { key: 'supplier', label: '供应商', required: false, hint: '须与供应商主数据名称一致' },
  { key: 'status', label: '状态', required: false, hint: '已生效/待完善主数据/已停用，默认已生效' },
]

export const PRODUCT_IMPORT_HEADERS = PRODUCT_IMPORT_FIELDS.map((f) => f.label)

export const PRODUCT_IMPORT_SAMPLE_ROWS: unknown[][] = [
  ['TK-99001', 'SPU-A', '示例商品A', '红色/M', '12.50', '30', '20', '15', '0.5', '6901234567890', '', '', '', '已生效'],
  ['TK-99002', '', '示例商品B', '', '', '', '', '', '', '', '', '', '', ''],
]

export function downloadProductImportTemplate() {
  downloadImportTemplate('商品主数据导入模板.xls', PRODUCT_IMPORT_FIELDS, PRODUCT_IMPORT_SAMPLE_ROWS)
}

/** 库存变更批量导入 — 与 InventoryQueryView 库存变更弹窗一致 */
export const INVENTORY_ADJUST_IMPORT_FIELDS: ImportFieldDef[] = [
  { key: 'customerCode', label: '客户代码', required: true, hint: '货盘池填 TKL，客户持有填 TKL0001 等' },
  { key: 'sku', label: 'SKU', required: true, hint: '系统 SKU 或客户 SKU' },
  { key: 'warehouseCode', label: '仓库', required: false, hint: '留空默认 JHB（WMS-JHB-01）' },
  { key: 'fromLocationCode', label: '原库位', required: false, hint: '移库时填写；仅改数量可留空' },
  { key: 'toLocationCode', label: '目标库位', required: true },
  { key: 'qty', label: '数量', required: true, hint: '目标库位的绝对库存数量（非负整数）' },
  { key: 'remark', label: '备注', required: false },
]

export const INVENTORY_ADJUST_IMPORT_HEADERS = INVENTORY_ADJUST_IMPORT_FIELDS.map((f) => f.label)

export const INVENTORY_ADJUST_SAMPLE_ROWS: unknown[][] = [
  ['TKL0001', 'TK-99001', 'WMS-JHB-01', '', 'A-01-01', '100', '盘点调整'],
  ['TKL', 'TK-99001', 'WMS-JHB-01', 'A-01-01', 'B-02-03', '50', '移库'],
]

export function downloadInventoryAdjustTemplate() {
  downloadImportTemplate('库存变更导入模板.xls', INVENTORY_ADJUST_IMPORT_FIELDS, INVENTORY_ADJUST_SAMPLE_ROWS)
}

export function resolveInventoryAdjustColumns(header: string[]) {
  const cols = header.map((h) => h.trim())
  return {
    customerIdx: findCsvColumn(cols, ['客户代码', '客户编码', 'customerCode', 'customer']),
    skuIdx: findCsvColumn(cols, ['SKU', 'sku', '系统SKU', '客户SKU']),
    whIdx: findCsvColumn(cols, ['仓库', '仓库代码', 'warehouseCode', 'warehouse']),
    fromLocIdx: findCsvColumn(cols, ['原库位', '源库位', 'fromLocation', 'from']),
    toLocIdx: findCsvColumn(cols, ['目标库位', '库位', 'toLocation', 'location']),
    qtyIdx: findCsvColumn(cols, ['数量', '库存数量', 'qty', 'quantity']),
    remarkIdx: findCsvColumn(cols, ['备注', 'remark']),
  }
}

export interface InventoryAdjustImportRow {
  customerCode: string
  sku: string
  warehouseCode: string
  fromLocationCode?: string
  toLocationCode: string
  qty: number
  remark?: string
}

export function parseInventoryAdjustCsvClient(content: string, defaultWarehouse = 'WMS-JHB-01'): InventoryAdjustImportRow[] {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) throw new Error('文件为空或仅有表头')
  const header = parseCsvLine(lines[0]).map((h) => h.trim())
  const {
    customerIdx, skuIdx, whIdx, fromLocIdx, toLocIdx, qtyIdx, remarkIdx,
  } = resolveInventoryAdjustColumns(header)
  if (customerIdx < 0) throw new Error('CSV 需包含「客户代码」列')
  if (skuIdx < 0) throw new Error('CSV 需包含「SKU」列')
  if (toLocIdx < 0) throw new Error('CSV 需包含「目标库位」或「库位」列')
  if (qtyIdx < 0) throw new Error('CSV 需包含「数量」列')

  const rows: InventoryAdjustImportRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i])
    const customerCode = cols[customerIdx]?.trim()
    const sku = cols[skuIdx]?.trim()
    const toLocationCode = cols[toLocIdx]?.trim()
    const qtyRaw = cols[qtyIdx]?.trim()
    if (!customerCode && !sku && !toLocationCode && !qtyRaw) continue
    if (!customerCode) throw new Error(`第 ${i + 1} 行：客户代码不能为空`)
    if (!sku) throw new Error(`第 ${i + 1} 行：SKU 不能为空`)
    if (!toLocationCode) throw new Error(`第 ${i + 1} 行：目标库位不能为空`)
    const qty = Number(qtyRaw)
    if (!Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty)) {
      throw new Error(`第 ${i + 1} 行：数量须为非负整数`)
    }
    rows.push({
      customerCode,
      sku,
      warehouseCode: (whIdx >= 0 ? cols[whIdx]?.trim() : '') || defaultWarehouse,
      fromLocationCode: fromLocIdx >= 0 ? cols[fromLocIdx]?.trim() || undefined : undefined,
      toLocationCode,
      qty,
      remark: remarkIdx >= 0 ? cols[remarkIdx]?.trim() || undefined : undefined,
    })
  }
  if (!rows.length) throw new Error('未解析到有效数据行')
  return rows
}
