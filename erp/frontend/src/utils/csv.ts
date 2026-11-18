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
  hint?: string
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Export every selected record, with required columns colored in Excel. No hint or sample rows. */
export function downloadRequiredFieldsExcel(filename: string, headers: string[], rows: unknown[][]) {
  const cellStyle = (header: string) => {
    const required = /(?:[*＊]|（必填）)$/.test(header)
    return `border:1px solid #94a3b8;padding:8px 12px;white-space:nowrap;text-align:left;vertical-align:middle;mso-number-format:'\\@';background-color:${required ? '#ffc7ce' : '#ffffff'};color:${required ? '#9c0006' : '#0f172a'}`
  }
  const widths = headers.map((header, index) => `<col width="${importColumnPixels(header, rows.map(row => row[index]))}" />`).join('')
  const heading = headers.map(header => `<th style="${cellStyle(header)}">${escapeHtml(header)}</th>`).join('')
  const body = rows.map(row => `<tr>${headers.map((header, index) => `<td style="${cellStyle(header)}">${escapeHtml(row[index])}</td>`).join('')}</tr>`).join('')
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8" /></head><body><table style="border-collapse:collapse"><colgroup>${widths}</colgroup><thead><tr>${heading}</tr></thead><tbody>${body}</tbody></table></body></html>`
  const blob = new Blob(['\uFEFF', html], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${filename.replace(/\.(csv|xls|xlsx)$/i, '')}.xls`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function normalizeImportHeader(label: string) {
  return label.trim().replace(/\s*[*＊]$/, '').trim()
}

function importColumnPixels(header: string, values: unknown[]) {
  const displayWidth = (value: unknown) => String(value ?? '').split(/\r?\n/).reduce((max, line) =>
    Math.max(max, [...line].reduce((size, char) => size + (char.charCodeAt(0) > 255 ? 2 : 1), 0)), 0)
  const width = values.reduce<number>((max, value) => Math.max(max, displayWidth(value)), displayWidth(header))
  return Math.max(128, Math.min(560, (width + 5) * 9))
}

/** 下载 Excel 可直接打开的空白导入模板。 */
export function downloadImportTemplate(
  filename: string,
  columns: ImportTemplateColumn[],
  sampleRows: unknown[][],
) {
  const labels = columns.map(column => column.required ? `${column.label} *` : column.label)
  const colGroup = columns
    .map((column, index) => {
      const width = importColumnPixels(labels[index]!, [...sampleRows.map(row => row[index]), column.hint])
      return `<col width="${width}" style="width:${width}px" />`
    })
    .join('')
  const header = columns
    .map((column, index) => `<th class="${column.required ? 'required' : 'optional'}" title="${escapeHtml(column.hint || '')}">${escapeHtml(labels[index])}</th>`)
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
  <table>${colGroup}<thead><tr>${header}</tr></thead><tbody>${inputRows}</tbody></table>
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
  const rows = [...doc.querySelectorAll('table tr')].map((row) =>
    row.matches('.example,.hint') ? [] : [...row.querySelectorAll('th,td')].map((cell) => cell.textContent?.trim() ?? ''),
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
    const t = normalizeImportHeader(h)
    return lower.includes(t.toLowerCase()) || aliases.includes(t)
  })
}
