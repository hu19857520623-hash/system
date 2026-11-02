import { InboundIdentityError } from './inbound-snapshot-guard.util.js'

type Plan = { lineItems?: string | null; attachments?: string | null; totalQty: number; receivedQty: number; skuCount: number; boxCount: number }
const maxInt = 2_147_483_647
const count = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maxInt
const bad = (message: string) => new InboundIdentityError(400, message)
function array(raw: string | null | undefined, label: string): Record<string, unknown>[] {
  let value: unknown
  try { value = raw == null ? [] : JSON.parse(raw) } catch { throw bad(`${label}资料不是有效格式，请核对后保存`) }
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw bad(`${label}必须是明细列表，请核对后保存`)
  return value
}

/** Decode without changing persisted bytes or silently turning bad plans into empty plans. */
export function readInboundPlan(data: Plan, draftTotals = true) {
  const lineItems = array(data.lineItems, '入库货品'), attachments = array(data.attachments, '入库附件')
  const boxes = new Set<number>(), skus = new Set<string>()
  let total = 0
  for (const [index, line] of lineItems.entries()) {
    if (typeof line.sku !== 'string' || !line.sku.trim() || !count(line.qty, 1)) throw bad(`第 ${index + 1} 行 SKU 和数量须有效，数量须为支持范围内的正整数`)
    const boxNo = line.boxNo ?? index + 1
    if (!count(boxNo, 1)) throw bad(`第 ${index + 1} 行箱号须为支持范围内的正整数`)
    for (const field of ['name', 'packType', 'stockType']) if (line[field] != null && typeof line[field] !== 'string') throw bad(`第 ${index + 1} 行品名、包装和库存类型须为文本`)
    boxes.add(boxNo); skus.add(line.sku.trim()); total += line.qty
  }
  if (!count(total)) throw bad('货品合计数量超出支持范围，请核对后保存')
  for (const [index, file] of attachments.entries()) {
    for (const field of ['kind', 'fileName', 'url', 'uploadedAt']) if (typeof file[field] !== 'string' || !file[field].trim()) throw bad(`第 ${index + 1} 个附件缺少有效类型、文件名、地址或上传时间，请重新上传`)
    const url = String(file.url)
    if (!/^https?:\/\//i.test(url) && !/^\/(?!\/)/.test(url) && !/^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,/i.test(url)) throw bad(`第 ${index + 1} 个附件地址无法安全保存，请重新上传`)
    for (const field of ['fileType', 'sku', 'platformBarcode', 'labelRole', 'localStorageRef', 'localStorageKey']) if (file[field] != null && typeof file[field] !== 'string') throw bad(`第 ${index + 1} 个附件的说明须为文本，请重新上传`)
    for (const field of ['erpAttachmentId', 'unitIndex', 'sourcePage', 'sourceRow', 'sourceColumn']) if (file[field] != null && !count(file[field], 1)) throw bad(`第 ${index + 1} 个附件的编号或位置无效，请重新上传`)
  }
  if (draftTotals && (!count(data.totalQty) || data.totalQty !== total || data.receivedQty !== 0 || data.skuCount !== skus.size || (lineItems.length ? data.boxCount !== boxes.size : ![0, 1].includes(data.boxCount)))) throw bad('草稿总数量、SKU 数或箱数与货品明细不一致，请核对后保存')
  return { lineItems, attachments }
}

/** Validate before coercion: booleans/numeric strings must not become inventory counts. */
export function assertInboundInputCounts(row: Record<string, unknown>) {
  for (const field of ['deliveryMethod', 'warehouse', 'createdAt', 'status']) if (typeof row[field] !== 'string' || !row[field].trim()) throw bad('入库单缺少有效交货方式、仓库、日期或状态，请核对后保存')
  const limits: Record<string, number> = { id: 50, inboundNo: 50, customerId: 50, source: 50, inboundType: 50, deliveryMethod: 50, status: 30, createdAt: 40, eta: 40, warehouse: 100, referenceNo: 100, trackingNo: 100, contact: 100, contactPhone: 50, skuHint: 200, exceptionCode: 50 }
  for (const [field, limit] of Object.entries(limits)) if (row[field] != null && (typeof row[field] !== 'string' || [...row[field]].length > limit)) throw bad('入库单文本资料类型或长度不符合要求，请核对后保存')
  for (const field of ['remark', 'exceptionReason']) if (row[field] != null && typeof row[field] !== 'string') throw bad('入库单备注和异常说明须为文本，请核对后保存')
  for (const field of ['lineItems', 'attachments']) if (row[field] != null && !Array.isArray(row[field])) throw bad('入库货品和附件必须是明细列表，请核对后保存')
  for (const field of ['totalQty', 'skuCount', 'boxCount', 'receivedQty']) {
    if (field === 'receivedQty' && row[field] == null) continue
    if (!count(row[field])) throw bad('入库数量、SKU 数和箱数须为支持范围内的非负整数，请核对后保存')
  }
}
