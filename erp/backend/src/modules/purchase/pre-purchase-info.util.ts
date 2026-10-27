import { BadRequestException } from '@nestjs/common'

export const PRE_PURCHASE_INFO_MAX_ROWS = 500

type Column = { key: string; label: string; kind?: 'number' | 'integer' | 'boolean' | 'date'; max?: number; scale?: number; length?: number; readonly?: boolean; required?: boolean; positive?: boolean }
export const PRE_PURCHASE_INFO_COLUMNS: Column[] = [
  { key: 'prePoNo', label: '预采购单号', readonly: true, required: true },
  { key: 'applyNo', label: '选品单号', readonly: true },
  { key: 'sku', label: 'SKU', length: 30, required: true },
  { key: 'productName', label: '商品名称', length: 300, required: true },
  { key: 'spec', label: '规格', length: 100, required: true },
  { key: 'supplierName', label: '供应商', length: 200, required: true },
  { key: 'supplierContactName', label: '供应商联系人', length: 50 },
  { key: 'supplierContactPhone', label: '供应商电话', length: 30 },
  { key: 'supplierAddress', label: '供应商地址', length: 500 },
  { key: 'plannedQty', label: '计划数量', kind: 'integer', required: true, positive: true },
  { key: 'unitPrice', label: '单价', kind: 'number', required: true, positive: true },
  { key: 'domesticFreight', label: '国内运费', kind: 'number' },
  { key: 'currency', label: '币种', length: 10 },
  { key: 'warehouseCode', label: '目标中转仓编码', length: 30 },
  { key: 'expectedArrival', label: '预计到货', kind: 'date' },
  { key: 'productLink', label: '商品链接', length: 500 },
  { key: 'accessories', label: '配件' },
  { key: 'productImageUrl', label: '商品图片链接', length: 500 },
  { key: 'manualUrl', label: '说明书链接', length: 500 },
  { key: 'moq', label: '起订量', kind: 'integer' },
  { key: 'leadTimeDays', label: '交期天数', kind: 'integer' },
  { key: 'taxRate', label: '税率', kind: 'number', max: 100 },
  { key: 'invoiceTaxRate', label: '开票税率', kind: 'number', max: 100 },
  { key: 'unitTax', label: '单件税费', kind: 'number' },
  { key: 'unitFreight', label: '单件运费', kind: 'number' },
  { key: 'productLengthCm', label: '商品长(cm)', kind: 'number', max: 999999.99, required: true, positive: true },
  { key: 'productWidthCm', label: '商品宽(cm)', kind: 'number', max: 999999.99, required: true, positive: true },
  { key: 'productHeightCm', label: '商品高(cm)', kind: 'number', max: 999999.99, required: true, positive: true },
  { key: 'productVolumeCbm', label: '商品体积(m³)', readonly: true },
  { key: 'packageWeightKg', label: '包装重量(kg)', kind: 'number', max: 99999.999, scale: 3 },
  { key: 'packageLengthCm', label: '包装长(cm)', kind: 'number', max: 999999.99, required: true, positive: true },
  { key: 'packageWidthCm', label: '包装宽(cm)', kind: 'number', max: 999999.99, required: true, positive: true },
  { key: 'packageHeightCm', label: '包装高(cm)', kind: 'number', max: 999999.99, required: true, positive: true },
  { key: 'packageVolumeCbm', label: '包装体积(m³)', readonly: true },
  { key: 'volumetricWeightKg', label: '体积重(kg)', readonly: true },
  { key: 'sampleStatus', label: '样品状态', length: 100 },
  { key: 'samplePackageInfo', label: '样品包装信息' },
  { key: 'sampleImageUrl', label: '样品图片链接', length: 500 },
  { key: 'doubleLayerCarton', label: '双层纸箱', kind: 'boolean' },
  { key: 'notPurchaseReason', label: '不采购原因' },
  { key: 'logoUnitFee', label: 'LOGO单价', kind: 'number' },
  { key: 'logoTotalFee', label: 'LOGO总价', kind: 'number', max: 999999999999.99 },
  { key: 'cartonTotalPrice', label: '纸箱总价', kind: 'number', max: 999999999999.99 },
  { key: 'spareCartonUnitPrice', label: '备用纸箱单价', kind: 'number' },
  { key: 'spareCartonQty', label: '备用纸箱数量', kind: 'integer' },
  { key: 'piecesPerCarton', label: '每箱件数', kind: 'integer' },
  { key: 'remark', label: '备注', length: 2000 },
  { key: 'status', label: '状态', readonly: true },
  { key: 'purchaserName', label: '采购员', readonly: true },
  { key: 'cancelReason', label: '取消原因', readonly: true },
  { key: 'linkedPoNo', label: '关联采购单号', readonly: true },
  { key: 'assignerName', label: '分配人', readonly: true },
  { key: 'assignedAtStr', label: '分配时间', readonly: true },
  { key: 'confirmedAtStr', label: '确认时间', readonly: true },
  { key: 'createdAtStr', label: '创建时间', readonly: true },
]

export const PRE_PURCHASE_INFO_HINT_MARKER = '填写说明（请保留此行）'

export interface PrePurchaseInfoFailure {
  lineNo: number
  prePoNo: string
  field: string
  value: string
  reason: string
}

export class PrePurchaseInfoValidationException extends BadRequestException {
  constructor(readonly failures: PrePurchaseInfoFailure[]) {
    super(failures.slice(0, 3).map(item => `第 ${item.lineNo} 行（${item.prePoNo || '未填单号'}）「${item.field}」：${item.reason}`).join('；') + '；整批未更新')
  }
}

function columnHint(column: Column) {
  const prefix = column.required ? '必填；' : column.readonly ? '只读；' : '选填；空白保留原值；'
  if (column.key === 'prePoNo') return PRE_PURCHASE_INFO_HINT_MARKER
  if (column.readonly) return prefix + '仅供查看，导入不修改'
  if (column.kind === 'date') return prefix + '有效日期 YYYY-MM-DD'
  if (column.kind === 'boolean') return prefix + '填写是或否'
  if (column.kind === 'integer' || column.kind === 'number') {
    const scale = column.kind === 'integer' ? 0 : column.scale ?? 2
    const max = column.max ?? (scale === 0 ? 2147483647 : 9999999999.99)
    return prefix + `${column.positive ? '大于 0' : '不小于 0'}，最大 ${max}，${scale ? `最多 ${scale} 位小数` : '整数'}`
  }
  return prefix + (column.length ? `最多 ${column.length} 字` : '填写文字') + (column.key.endsWith('Url') || column.key === 'productLink' ? '；链接以 http:// 或 https:// 开头' : '')
}

// Parse the whole document so quoted notes containing newlines survive export/import.
function parseInfoCsv(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  const text = content.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ }
      else if (quoted || !cell) quoted = !quoted
      else throw new BadRequestException('CSV 引号格式错误，请使用导出的 CSV 文件')
    } else if (!quoted && (char === ',' || char === '\n' || char === '\r')) {
      row.push(cell); cell = ''
      if (char !== ',') {
        rows.push(row)
        row = []
        if (char === '\r' && text[i + 1] === '\n') i++
      }
    } else cell += char
  }
  if (quoted) throw new BadRequestException('CSV 引号未闭合，请检查文件')
  row.push(cell)
  if (row.some(value => value.trim())) rows.push(row)
  return rows
}

export function exportPrePurchaseInfo(items: Record<string, any>[]) {
  const statuses: Record<string, string> = { assigned: '进行中', returned: '退回待修改', confirmed: '已生成采购单', cancelled: '已取消' }
  return {
    headers: PRE_PURCHASE_INFO_COLUMNS.map(column => column.label + (column.required ? '（必填）' : column.readonly ? '（只读）' : '')),
    rows: [PRE_PURCHASE_INFO_COLUMNS.map(columnHint), ...items.map(item => PRE_PURCHASE_INFO_COLUMNS.map(column => {
      const value = item[column.key]
      if (value == null || (column.key === 'supplierName' && value === '—')) return ''
      if (column.kind === 'date') return new Date(value).toISOString().slice(0, 10)
      if (column.kind === 'boolean') return value ? '是' : '否'
      if (column.key === 'status') return statuses[value] || value
      return value
    }))],
    total: items.length,
  }
}

export function parsePrePurchaseInfo(content: string) {
  if (typeof content !== 'string' || !content.trim()) throw new BadRequestException('请选择包含预采购单资料的 CSV 文件')
  const [headers, ...allRows] = parseInfoCsv(content)
  if (!headers || !allRows.length) throw new BadRequestException('文件中没有可导入的预采购单')
  const columns = headers.map(label => {
    const normalized = label.trim().replace(/（(?:必填|只读)）$/, '')
    return PRE_PURCHASE_INFO_COLUMNS.find(column => column.label === normalized || column.key === normalized)
  })
  if (columns.some(column => !column)) throw new BadRequestException('存在无法识别的表头，请保留导出文件的原表头')
  const keys = columns.map(column => column!.key)
  if (new Set(keys).size !== keys.length) throw new BadRequestException('文件中存在重复的表头')
  const orderIndex = keys.indexOf('prePoNo')
  if (orderIndex < 0) throw new BadRequestException('文件必须包含「预采购单号」列，用于匹配更新已有单据')
  const missing = PRE_PURCHASE_INFO_COLUMNS.filter(column => column.required && !keys.includes(column.key))
  if (missing.length) throw new BadRequestException(`缺少必填列：${missing.map(column => column.label).join('、')}。请使用最新导出文件`)
  const rows = allRows.map((cells, index) => ({ cells, lineNo: index + 2 }))
    .filter(({ cells }) => cells.some(value => value.trim()) && cells[orderIndex] !== PRE_PURCHASE_INFO_HINT_MARKER)
  if (!rows.length) throw new BadRequestException('文件中没有可导入的预采购单')
  if (rows.length > PRE_PURCHASE_INFO_MAX_ROWS) throw new BadRequestException(`每次最多导入 ${PRE_PURCHASE_INFO_MAX_ROWS} 张预采购单，请拆分文件`)
  const seen = new Set<string>()
  const seenSkus = new Map<string, number>()
  const failures: PrePurchaseInfoFailure[] = []
  const lines = rows.map(({ cells, lineNo }) => {
    const prePoNo = cells[orderIndex]?.trim() || ''
    const fail = (field: string, value: string, reason: string) => { failures.push({ lineNo, prePoNo, field, value, reason }) }
    if (cells.length !== headers.length) fail('整行', '', '列数与表头不一致')
    if (!prePoNo) fail('预采购单号', prePoNo, '必填，不能为空')
    if (prePoNo.length > 30) fail('预采购单号', prePoNo, '不能超过 30 字')
    if (prePoNo && seen.has(prePoNo.toLowerCase())) fail('预采购单号', prePoNo, '预采购单号重复，请每张单只保留一行')
    seen.add(prePoNo.toLowerCase())
    const data: Record<string, any> = {}
    columns.forEach((column, i) => {
      const value = cells[i]?.trim() || ''
      if (!column || column.readonly) return
      if (!value) {
        if (column.required) fail(column.label, value, '必填，不能为空')
        return // Optional empty cells preserve existing values.
      }
      if (column.kind === 'integer' || column.kind === 'number') {
        const scale = column.kind === 'integer' ? 0 : column.scale ?? 2
        const number = Number(value)
        const max = column.max ?? (scale === 0 ? 2147483647 : 9999999999.99)
        if (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(number) || number < 0 || (column.positive && number <= 0) || number > max || (value.split('.')[1]?.length || 0) > scale) {
          fail(column.label, value, `须为有效${scale === 0 ? '整数' : `数字（最多 ${scale} 位小数）`}，${column.positive ? '大于零' : '不小于零'}，最大 ${max}`)
          return
        }
        data[column.key] = number
      } else if (column.kind === 'boolean') {
        if (!['是', '否', 'true', 'false', '1', '0'].includes(value.toLowerCase())) { fail(column.label, value, '请填写是或否'); return }
        data[column.key] = ['是', 'true', '1'].includes(value.toLowerCase())
      } else if (column.kind === 'date') {
        const normalized = value.replace(/[/.]/g, '-')
        const parts = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized)
        const date = parts ? `${parts[1]}-${parts[2].padStart(2, '0')}-${parts[3].padStart(2, '0')}` : ''
        if (!date || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) { fail(column.label, value, '须为有效的 YYYY-MM-DD 日期'); return }
        data[column.key] = date
      } else {
        if (column.length && value.length > column.length) fail(column.label, value, `不能超过 ${column.length} 字`)
        if (Buffer.byteLength(value, 'utf8') > 65535) fail(column.label, value, '文字内容过长，请缩短后导入')
        if (column.key.endsWith('Url') || column.key === 'productLink') {
          try {
            const url = new URL(value)
            if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol')
          } catch { fail(column.label, value, '须为有效的 http:// 或 https:// 链接') }
        }
        data[column.key] = value
      }
    })
    if (data.sku) {
      const normalized = data.sku.toLowerCase()
      if (seenSkus.has(normalized)) fail('SKU', data.sku, `与第 ${seenSkus.get(normalized)} 行重复，请核对商品`)
      else seenSkus.set(normalized, lineNo)
    }
    for (const prefix of ['product', 'package']) {
      const dims = ['LengthCm', 'WidthCm', 'HeightCm'].map(suffix => data[prefix + suffix])
      if (dims.every(value => value > 0) && dims.reduce((volume, value) => volume * value, 1) / 1_000_000 > 9999.999999) {
        fail(prefix === 'product' ? '商品长宽高' : '包装长宽高', dims.join(' × '), '计算体积超出上限 9999.999999 m³，请核对厘米单位')
      }
    }
    return { lineNo, prePoNo, data }
  })
  if (failures.length) throw new PrePurchaseInfoValidationException(failures)
  return lines
}
