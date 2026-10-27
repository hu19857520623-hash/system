import { BadRequestException } from '@nestjs/common'

export const PRE_PURCHASE_INFO_MAX_ROWS = 500

type Column = { key: string; label: string; kind?: 'number' | 'integer' | 'boolean' | 'date'; max?: number; scale?: number; length?: number; readonly?: boolean }
export const PRE_PURCHASE_INFO_COLUMNS: Column[] = [
  { key: 'prePoNo', label: '预采购单号', readonly: true },
  { key: 'applyNo', label: '选品单号', readonly: true },
  { key: 'sku', label: 'SKU', length: 30 },
  { key: 'productName', label: '商品名称', length: 300 },
  { key: 'spec', label: '规格', length: 100 },
  { key: 'supplierName', label: '供应商', length: 200 },
  { key: 'supplierContactName', label: '供应商联系人', length: 50 },
  { key: 'supplierContactPhone', label: '供应商电话', length: 30 },
  { key: 'supplierAddress', label: '供应商地址', length: 500 },
  { key: 'plannedQty', label: '计划数量', kind: 'integer' },
  { key: 'unitPrice', label: '单价', kind: 'number' },
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
  { key: 'taxRate', label: '税率', kind: 'number', max: 999.99 },
  { key: 'invoiceTaxRate', label: '开票税率', kind: 'number', max: 999.99 },
  { key: 'unitTax', label: '单件税费', kind: 'number' },
  { key: 'unitFreight', label: '单件运费', kind: 'number' },
  { key: 'productLengthCm', label: '商品长(cm)', kind: 'number', max: 999999.99 },
  { key: 'productWidthCm', label: '商品宽(cm)', kind: 'number', max: 999999.99 },
  { key: 'productHeightCm', label: '商品高(cm)', kind: 'number', max: 999999.99 },
  { key: 'productVolumeCbm', label: '商品体积(m³)', readonly: true },
  { key: 'packageWeightKg', label: '包装重量(kg)', kind: 'number', max: 99999.999, scale: 3 },
  { key: 'packageLengthCm', label: '包装长(cm)', kind: 'number', max: 999999.99 },
  { key: 'packageWidthCm', label: '包装宽(cm)', kind: 'number', max: 999999.99 },
  { key: 'packageHeightCm', label: '包装高(cm)', kind: 'number', max: 999999.99 },
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
        if (row.some(value => value.trim())) rows.push(row)
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
    headers: PRE_PURCHASE_INFO_COLUMNS.map(column => column.label),
    rows: items.map(item => PRE_PURCHASE_INFO_COLUMNS.map(column => {
      const value = item[column.key]
      if (value == null || (column.key === 'supplierName' && value === '—')) return ''
      if (column.kind === 'date') return new Date(value).toISOString().slice(0, 10)
      if (column.kind === 'boolean') return value ? '是' : '否'
      if (column.key === 'status') return statuses[value] || value
      return value
    })),
    total: items.length,
  }
}

export function parsePrePurchaseInfo(content: string) {
  if (typeof content !== 'string' || !content.trim()) throw new BadRequestException('请选择包含预采购单资料的 CSV 文件')
  const [headers, ...rows] = parseInfoCsv(content)
  if (!headers || !rows.length) throw new BadRequestException('文件中没有可导入的预采购单')
  if (rows.length > PRE_PURCHASE_INFO_MAX_ROWS) throw new BadRequestException(`每次最多导入 ${PRE_PURCHASE_INFO_MAX_ROWS} 张预采购单，请拆分文件`)
  const columns = headers.map(label => PRE_PURCHASE_INFO_COLUMNS.find(column => column.label === label.trim() || column.key === label.trim()))
  if (columns.some(column => !column)) throw new BadRequestException('存在无法识别的表头，请保留导出文件的原表头')
  const keys = columns.map(column => column!.key)
  if (new Set(keys).size !== keys.length) throw new BadRequestException('文件中存在重复的表头')
  const orderIndex = keys.indexOf('prePoNo')
  if (orderIndex < 0) throw new BadRequestException('文件必须包含「预采购单号」列，用于匹配更新已有单据')
  const seen = new Set<string>()
  return rows.map((cells, index) => {
    const lineNo = index + 2
    const prePoNo = cells[orderIndex]?.trim() || ''
    const fail = (message: string): never => { throw new BadRequestException(`第 ${lineNo} 行${prePoNo ? `（${prePoNo}）` : ''}：${message}；整批未更新`) }
    if (cells.length !== headers.length) fail('列数与表头不一致')
    if (!prePoNo) fail('预采购单号不能为空')
    if (prePoNo.length > 30) fail('预采购单号不能超过 30 字')
    if (seen.has(prePoNo.toLowerCase())) fail('预采购单号重复，请每张单只保留一行')
    seen.add(prePoNo.toLowerCase())
    const data: Record<string, any> = {}
    columns.forEach((column, i) => {
      const value = cells[i]?.trim() || ''
      if (!column || column.readonly || !value) return // Empty cells preserve existing values.
      if (column.kind === 'integer' || column.kind === 'number') {
        const scale = column.kind === 'integer' ? 0 : column.scale ?? 2
        const number = Number(value)
        if (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(number) || number < (column.key === 'plannedQty' ? 1 : 0) || number > (column.max ?? (scale === 0 ? 2147483647 : 9999999999.99)) || (value.split('.')[1]?.length || 0) > scale) {
          fail(`「${column.label}」须为有效的非负${scale === 0 ? '整数' : `数字（最多 ${scale} 位小数）`}${column.key === 'plannedQty' ? '，且大于零' : ''}`)
        }
        data[column.key] = number
      } else if (column.kind === 'boolean') {
        if (!['是', '否', 'true', 'false', '1', '0'].includes(value.toLowerCase())) fail(`「${column.label}」请填写是或否`)
        data[column.key] = ['是', 'true', '1'].includes(value.toLowerCase())
      } else if (column.kind === 'date') {
        const normalized = value.replace(/[/.]/g, '-')
        const parts = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized)
        const date = parts ? `${parts[1]}-${parts[2].padStart(2, '0')}-${parts[3].padStart(2, '0')}` : ''
        if (!date || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) fail(`「${column.label}」须为有效的 YYYY-MM-DD 日期`)
        data[column.key] = date
      } else {
        if (column.length && value.length > column.length) fail(`「${column.label}」不能超过 ${column.length} 字`)
        data[column.key] = value
      }
    })
    if (!Object.keys(data).length) fail('没有可更新的资料')
    return { lineNo, prePoNo, data }
  })
}
