export function escapeCsv(val: unknown) {
  const s = String(val ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const bom = '\uFEFF'
  const content = bom + [headers.join(','), ...rows.map((r) => r.map(escapeCsv).join(','))].join('\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export interface ImportTemplateColumn {
  label: string
  required?: boolean
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function templateColumnWidth(column: ImportTemplateColumn, rows: unknown[][], index: number) {
  const contentLength = Math.max(
    column.label.length,
    ...rows.map((row) => String(row[index] ?? '').length),
  )
  return Math.min(34, Math.max(14, contentLength + 6))
}

/** 下载 Excel 可直接打开的导入模板：第一行为字段，第二行起为示例。 */
export function downloadImportTemplate(
  filename: string,
  columns: ImportTemplateColumn[],
  sampleRows: unknown[][],
) {
  const exampleRows = sampleRows.slice(0, 1)
  const colGroup = columns
    .map((column, index) => {
      const width = templateColumnWidth(column, exampleRows, index) * 9
      return `<col width="${width}" style="width:${width}px" />`
    })
    .join('')
  const header = columns
    .map((column) => `<th class="${column.required ? 'required' : 'optional'}">${escapeHtml(column.label)}</th>`)
    .join('')
  const examples = exampleRows
    .map((row) => `<tr class="example">${columns.map((_, index) => `<td>${escapeHtml(row[index])}</td>`).join('')}</tr>`)
    .join('')
  const inputRows = Array.from(
    { length: 10 },
    () => `<tr>${columns.map(() => '<td></td>').join('')}</tr>`,
  ).join('')
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
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
    tr:nth-child(even) td { background: #f8fafc; }
  </style>
</head>
<body>
  <table>${colGroup}<thead><tr>${header}</tr></thead><tbody>${examples}${inputRows}</tbody></table>
</body>
</html>`
  const blob = new Blob(['\uFEFF', html], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${filename.replace(/\.(csv|xls|xlsx)$/i, '')}.xls`
  anchor.click()
  URL.revokeObjectURL(url)
}

/** 将系统下载的 HTML Excel 模板转为现有导入接口使用的 CSV 文本。 */
export function normalizeImportFileText(text: string) {
  const normalized = text.replace(/^\uFEFF/, '')
  if (!/<table[\s>]/i.test(normalized)) return text

  const doc = new DOMParser().parseFromString(normalized, 'text/html')
  const rows = [...doc.querySelectorAll('table tr:not(.example)')].map((row) =>
    [...row.querySelectorAll('th,td')].map((cell) => cell.textContent?.trim() ?? ''),
  )
  if (!rows.length) return text
  return `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\n')}`
}

export function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') inQuotes = false
      else cur += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { result.push(cur); cur = '' }
    else cur += c
  }
  result.push(cur)
  return result
}

export function findCsvColumn(header: string[], aliases: string[]) {
  const lower = aliases.map((a) => a.toLowerCase())
  return header.findIndex((h) => {
    const t = h.trim()
    return lower.includes(t.toLowerCase()) || aliases.includes(t)
  })
}
