export interface InboundBoxLine {
  id: string
  sku: string
  name: string
  qty: number
  boxNo: number
  packType: string
  stockType: string
}

function positiveInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0
}

export function buildInboundBoxLines(
  existing: InboundBoxLine[],
  input: Omit<InboundBoxLine, 'id' | 'qty' | 'boxNo'> & { boxCount: number; qtyPerBox: number },
): InboundBoxLine[] {
  if (!input.sku.trim()) throw new Error('请输入 SKU')
  if (!positiveInteger(input.boxCount)) throw new Error('箱数必须为正整数')
  if (!positiveInteger(input.qtyPerBox)) throw new Error('每箱数量必须为正整数')
  if (input.boxCount > 10000) throw new Error('单次最多添加 10000 箱，请分次添加或批量上传')
  const lastBox = existing.reduce((max, line) => positiveInteger(line.boxNo) ? Math.max(max, line.boxNo) : max, 0)
  if (!Number.isSafeInteger(lastBox + input.boxCount) || !Number.isSafeInteger(input.boxCount * input.qtyPerBox)) {
    throw new Error('箱号或货品数量超出支持范围')
  }
  return Array.from({ length: input.boxCount }, (_, index) => ({
    id: crypto.randomUUID(),
    sku: input.sku.trim(),
    name: input.name,
    qty: input.qtyPerBox,
    boxNo: lastBox + index + 1,
    packType: input.packType,
    stockType: input.stockType,
  }))
}

export function validateInboundBoxLines(lines: InboundBoxLine[]): string | undefined {
  for (const [index, line] of lines.entries()) {
    if (!line.sku.trim()) return `第 ${index + 1} 行请输入 SKU`
    if (!positiveInteger(line.boxNo)) return `第 ${index + 1} 行箱号必须为正整数`
    if (!positiveInteger(line.qty)) return `第 ${index + 1} 行数量必须为正整数`
  }
  if (!Number.isSafeInteger(lines.reduce((total, line) => total + line.qty, 0))) return '货品总数量超出支持范围'
}
