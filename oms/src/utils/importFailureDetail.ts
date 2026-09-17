import { downloadCsv } from '../data/csvImportExport'

export type ImportRowFailure = {
  lineNo: number
  reason: string
  sku?: string
}

export function formatImportFailureLine(f: ImportRowFailure): string {
  const skuPart = f.sku?.trim() ? ` · SKU ${f.sku.trim()}` : ''
  const lineLabel = f.lineNo > 0 ? String(f.lineNo) : '—'
  return `第 ${lineLabel} 行${skuPart}：${f.reason}`
}

export function downloadImportFailuresCsv(filename: string, failures: ImportRowFailure[]) {
  if (!failures.length) return
  const base = filename.replace(/\.csv$/i, '')
  downloadCsv(
    `${base}.csv`,
    [
      ['行号', 'SKU', '失败原因'],
      ...failures.map(f => [
        f.lineNo > 0 ? String(f.lineNo) : '',
        f.sku?.trim() ?? '',
        f.reason,
      ]),
    ],
  )
}

/** 从旧版「第 N 行：原因」文案解析（无 SKU） */
export function failuresFromLegacyErrors(errors: string[]): ImportRowFailure[] {
  return errors.map(msg => {
    const m = msg.match(/^第\s*(\d+)\s*行(?:\s*·\s*SKU\s*(.+?))?[：:]\s*(.+)$/s)
    if (!m) return { lineNo: 0, reason: msg }
    return {
      lineNo: Number(m[1]) || 0,
      sku: m[2]?.trim() || undefined,
      reason: m[3]?.trim() || msg,
    }
  })
}

/** 与 ERP 一致：一次弹窗展示明细；确定 = 下载 CSV，取消 = 关闭 */
export function showImportFailuresDialog(
  summary: string,
  failures: ImportRowFailure[],
  csvFilename = '导入失败明细',
) {
  if (!failures.length) {
    window.alert(summary)
    return
  }
  const preview = failures.slice(0, 40).map(formatImportFailureLine).join('\n')
  const tail = failures.length > 40 ? `\n…共 ${failures.length} 条，确定可下载完整 CSV` : ''
  const body = `${summary}\n\n${preview}${tail}\n\n【确定】下载失败明细 CSV\n【取消】关闭`
  if (window.confirm(body)) {
    downloadImportFailuresCsv(csvFilename, failures)
  }
}
