import { normalizeImportHeader } from '@/utils/csv'
import { ImportValidationError, type ImportRowFailure } from '@/utils/importFailureDetail'

function stocktakeCsvGrid(source: string, sourceLineNos: number[]): string[][] {
  const text = source.replace(/^\uFEFF/, ''), delimiter = text.split(/\r?\n/,1)[0]?.includes('\t') && !text.split(/\r?\n/,1)[0]?.includes(',') ? '\t' : ','
  const rows: string[][] = [];let row: string[] = [], cell = '', quoted = false, closed = false
  let physicalLine = 1, rowStart = 1
  for (let i=0;i<text.length;i++) {
    const c=text[i]
    if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) physicalLine++
    if (quoted) {
      if (c==='"' && text[i+1]==='"') {cell+='"';i++}
      else if (c==='"') {quoted=false;closed=true}
      else cell+=c
    } else if (c===delimiter) {row.push(cell);cell='';closed=false}
    else if (c==='\r' || c==='\n') {if(c==='\r' && text[i+1]==='\n'){i++;physicalLine++}row.push(cell);rows.push(row);sourceLineNos.push(rowStart);rowStart=physicalLine;row=[];cell='';closed=false}
    else if (c==='"' && !cell && !closed) quoted=true
    else if (closed && !/\s/.test(c)) throw new Error('CSV引号格式不正确，请重新导出CSV')
    else if (c==='"') throw new Error('CSV引号格式不正确，请重新导出CSV')
    else if (!closed) cell+=c
  }
  if (quoted) throw new Error('CSV存在未闭合的引号')
  if (cell || row.length) {row.push(cell);rows.push(row);sourceLineNos.push(rowStart)}
  return rows
}


type Line = { id: number; locationCode: string; sku: string }
export function stocktakeImportRows(grid: unknown[][], lines: Line[], canCount: (line: any) => boolean, sourceLineNos: number[] = []) {
  const headers = (grid[0] || []).map(v => normalizeImportHeader(String(v ?? '').replace(/^\uFEFF/, '')))
  const columns = ['库位', 'SKU', '实盘数量'].map(name => {
    if (headers.filter(h => h === name).length !== 1) throw new Error(`表头须包含唯一的“${name}”列`)
    return headers.indexOf(name)
  })
  const result: { id: number; qty: number; sourceLineNo: number }[] = [], seen = new Set<number>()
  const failures: ImportRowFailure[] = []
  grid.slice(1).forEach((row, index) => {
    const qtyText = String(row[columns[2]!] ?? '').trim()
    if (!qtyText) return
    const location = String(row[columns[0]!] ?? '').trim(), sku = String(row[columns[1]!] ?? '').trim()
    const matches = lines.filter(line => line.locationCode === location && line.sku === sku)
    const sourceLineNo = sourceLineNos[index + 1] ?? index + 2
    const before = failures.length
    const fail = (field: string, reason: string) => { failures.push({ lineNo: sourceLineNo, field, reason, sku }) }
    if (!location) fail('库位', '填了实盘数量时不能为空')
    if (!sku) fail('SKU', '填了实盘数量时不能为空')
    const line = matches.length === 1 ? matches[0] : undefined
    if (location && sku && !line) fail('库位 / SKU', '未唯一匹配当前盘点明细')
    if (line && !canCount(line)) fail('整行', '该明细已提交或当前账号不能执行此阶段盘点')
    if (line && seen.has(line.id)) fail('库位 / SKU', '重复')
    if (!/^\d+$/.test(qtyText) || Number(qtyText) > 2147483647) fail('实盘数量', '须为0至2147483647的整数')
    if (line) seen.add(line.id)
    if (line && failures.length === before) result.push({ id: line.id, qty: Number(qtyText), sourceLineNo })
  })
  if (failures.length) throw new ImportValidationError(failures)
  if (!result.length) throw new Error('没有可导入的实盘数量，请填写模板的实盘数量列')
  return result
}

export async function readStocktakeFile(file: File, sourceLineNos: number[] = []): Promise<unknown[][]> {
  if (file.size > 5 * 1024 * 1024) throw new Error('文件不能超过5MB')
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readExcelFile } = await import('read-excel-file/universal')
    return (await readExcelFile(file))[0]?.data ?? []
  }
  if (!/\.csv$/i.test(file.name)) throw new Error('请选择.xlsx或.csv文件')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let text: string
  if (bytes[0] === 255 && bytes[1] === 254) text = new TextDecoder('utf-16le').decode(bytes)
  else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { text = new TextDecoder('gb18030').decode(bytes) } }
  return stocktakeCsvGrid(text, sourceLineNos)
}
