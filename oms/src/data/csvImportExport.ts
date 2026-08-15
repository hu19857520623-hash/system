export interface CsvColumn {
  key: string
  header: string
  required?: boolean
  /** 字段填写说明（用于导入界面的字段提示） */
  hint?: string
}

export function columnHeader(col: CsvColumn): string {
  return col.required ? `${col.header}*` : col.header
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function rowsToCsv(rows: string[][]): string {
  return '\ufeff' + rows.map(row => row.map(v => escapeCsvCell(String(v ?? ''))).join(',')).join('\r\n')
}

export function downloadCsv(filename: string, rows: string[][]) {
  const blob = new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

function buildImportTemplateHtml(title: string, columns: CsvColumn[], exampleRows: string[][]): string {
  const visibleExamples = exampleRows.slice(0, 1)
  const columnWidths = columns.map((col, index) => {
    const contentLength = Math.max(
      col.header.length,
      ...visibleExamples.map(row => String(row[index] ?? '').length),
    )
    return Math.min(34, Math.max(14, contentLength + 6))
  })
  const colGroup = columnWidths.map((width) => {
    const widthPx = width * 9
    return `<col width="${widthPx}" style="width:${widthPx}px" />`
  }).join('')
  const headerCells = columns.map(col => {
    const cls = col.required ? 'required' : 'optional'
    const star = col.required ? '<span class="required-star">*</span>' : ''
    return `<th class="${cls}">${escapeHtml(col.header)}${star}</th>`
  }).join('')

  const exampleHtml = visibleExamples.map(row => {
    const cells = columns.map((_, idx) => `<td>${escapeHtml(String(row[idx] ?? ''))}</td>`).join('')
    return `<tr class="example">${cells}</tr>`
  }).join('')
  const inputRows = Array.from(
    { length: 10 },
    () => `<tr>${columns.map(() => '<td></td>').join('')}</tr>`,
  ).join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    table { border-collapse: collapse; table-layout: fixed; }
    th, td {
      border: 1px solid #94a3b8;
      min-width: 120px;
      height: 32px;
      padding: 8px 12px;
      text-align: left;
      vertical-align: middle;
      white-space: nowrap;
      mso-number-format: "\\@";
    }
    th { height: 36px; background: #dbeafe; color: #0f172a; font-weight: 700; }
    th.required { background: #fee2e2; color: #991b1b; }
    th.optional { background: #e2e8f0; }
    .required-star { color: #dc2626; font-weight: 700; }
    .example:nth-child(even) td { background: #f8fafc; }
  </style>
</head>
<body>
  <table>
    ${colGroup}
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${exampleHtml}${inputRows}</tbody>
  </table>
</body>
</html>`
}

function downloadHtmlAsExcel(filename: string, html: string) {
  const blob = new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  const base = filename.replace(/\.(csv|xls|xlsx|html)$/i, '')
  anchor.download = `${base}.xls`
  anchor.click()
  URL.revokeObjectURL(url)
}

/** 下载批量导入模板（第一行字段、第二行示例，Excel 可直接打开） */
export function downloadTemplate(
  filename: string,
  columns: CsvColumn[],
  exampleRows: string[][] = [],
) {
  const title = filename.replace(/\.(csv|xls|xlsx|html)$/i, '')
  downloadHtmlAsExcel(filename, buildImportTemplateHtml(title, columns, exampleRows))
}

/** 简易 CSV 解析，支持引号与逗号 */
export function parseCsv(text: string): string[][] {
  const normalized = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i]
    const next = normalized[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cell += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(cell.trim())
      cell = ''
    } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
      row.push(cell.trim())
      if (row.some(v => v.length > 0)) rows.push(row)
      row = []
      cell = ''
      if (ch === '\r') i += 1
    } else if (ch !== '\r') {
      cell += ch
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim())
    if (row.some(v => v.length > 0)) rows.push(row)
  }

  return rows
}

/** 将系统生成的 HTML Excel 模板转回 CSV，支持填写后直接上传 .xls。 */
function normalizeImportFileText(text: string) {
  const normalized = text.replace(/^\uFEFF/, '').trim()
  if (!/<(?:html|table)\b/i.test(normalized)) return text

  const documentNode = new DOMParser().parseFromString(normalized, 'text/html')
  const rows = [...documentNode.querySelectorAll('table tr:not(.example)')].map((row) =>
    [...row.querySelectorAll('th,td')].map((cell) => cell.textContent?.trim() ?? ''),
  )
  return rows.length ? rowsToCsv(rows) : text
}

function normalizeHeader(value: string): string {
  return value.replace(/\*$/, '').replace(/\s+/g, '').trim().toLowerCase()
}

function isHintRow(row: string[]): boolean {
  return row.some(v => {
    const s = String(v).trim()
    return s.startsWith('必填')
      || s.startsWith('选填')
      || s.startsWith('填写')
      || /^选填[，,]/.test(s)
      || /^必填[，,]/.test(s)
  })
}

export function mapCsvRows(
  rows: string[][],
  columns: CsvColumn[],
): { records: Record<string, string>[]; errors: string[] } {
  if (rows.length === 0) return { records: [], errors: ['文件为空'] }

  const headerRow = rows[0]
  const headerMap = new Map<string, number>()
  headerRow.forEach((h, idx) => {
    headerMap.set(normalizeHeader(h), idx)
  })

  const missing = columns.filter(c => {
    if (!c.required) return false
    return !headerMap.has(normalizeHeader(columnHeader(c)))
      && !headerMap.has(normalizeHeader(c.header))
  })
  if (missing.length > 0) {
    return { records: [], errors: [`缺少必填列：${missing.map(c => columnHeader(c)).join('、')}`] }
  }

  let start = 1
  if (rows[1] && isHintRow(rows[1])) start = 2

  const records: Record<string, string>[] = []
  const errors: string[] = []

  for (let i = start; i < rows.length; i += 1) {
    const row = rows[i]
    if (row.every(v => !v.trim())) continue
    if (row[0]?.startsWith('#')) continue
    if (isHintRow(row)) continue

    const record: Record<string, string> = {}
    for (const col of columns) {
      const idx = headerMap.get(normalizeHeader(columnHeader(col)))
        ?? headerMap.get(normalizeHeader(col.header))
      record[col.key] = idx === undefined ? '' : String(row[idx] ?? '').trim()
    }

    for (const col of columns) {
      if (col.required && !record[col.key]) {
        errors.push(`第 ${i + 1} 行：${columnHeader(col)} 不能为空`)
      }
    }

    records.push(record)
  }

  return { records, errors }
}

export function pickCsvFile(accept = '.csv,.xls,.xlsx,text/csv,application/vnd.ms-excel'): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        reject(new Error('cancelled'))
        return
      }
      const reader = new FileReader()
      reader.onload = () => resolve(normalizeImportFileText(String(reader.result ?? '')))
      reader.onerror = () => reject(reader.error ?? new Error('read failed'))
      reader.readAsText(file, 'UTF-8')
    }
    input.click()
  })
}

export async function importCsvFile<T>(
  columns: CsvColumn[],
  parse: (records: Record<string, string>[]) => { data: T[]; errors: string[] },
): Promise<{ data: T[]; errors: string[] }> {
  const text = await pickCsvFile()
  const rows = parseCsv(text)
  const mapped = mapCsvRows(rows, columns)
  if (mapped.errors.length > 0) return { data: [], errors: mapped.errors }
  return parse(mapped.records)
}
