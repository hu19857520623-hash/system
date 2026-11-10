export function escapeCsv(val: unknown) {
  const s = String(val ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: unknown[][]) {
  const bom = '\uFEFF'
  return bom + [headers.join(','), ...rows.map((r) => r.map(escapeCsv).join(','))].join('\n')
}

export function parseCsv(text: string, options?: { preserveBlankLines?: boolean }): string[][] {
  const physicalLines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const lines = options?.preserveBlankLines ? physicalLines : physicalLines.filter(line => line.trim())
  const result: string[][] = []
  for (const line of lines) {
    const row: string[] = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
        else if (c === '"') inQuotes = false
        else cur += c
      } else if (c === '"') inQuotes = true
      else if (c === ',') { row.push(cur); cur = '' }
      else cur += c
    }
    row.push(cur)
    result.push(row)
  }
  return result
}
