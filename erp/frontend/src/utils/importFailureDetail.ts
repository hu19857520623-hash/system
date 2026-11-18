import { userFacingError } from '@erp/shared/user-facing-error'
import { downloadCsv } from '@/utils/csv.ts'

export type ImportRowFailure = {
  lineNo: number
  field?: string
  reason: string
  sku?: string
  /** 原始行内容（服务端截断保留），用于失败明细恢复 */
  row?: string
}

export class ImportValidationError extends Error {
  readonly failures: ImportRowFailure[]

  constructor(failures: ImportRowFailure[]) {
    super(failures.map(formatImportFailureLine).join('\n'))
    this.failures = failures
  }
}

export function formatImportFailureLine(f: ImportRowFailure): string {
  const skuPart = f.sku?.trim() ? ` · SKU ${f.sku.trim()}` : ''
  const rowPart = f.row?.trim() ? ` · 原行 ${f.row.trim()}` : ''
  const lineLabel = f.lineNo > 0 ? String(f.lineNo) : '—'
  return `第 ${lineLabel} 行，字段 ${f.field || '整行'}：${userFacingError(f.reason, undefined, '该行导入失败，请核对文件内容后重试')}${skuPart}${rowPart}`
}

export function downloadImportFailuresCsv(filename: string, failures: ImportRowFailure[]) {
  if (!failures.length) return
  const base = filename.replace(/\.csv$/i, '')
  const asText = (value: string) => /^[\s]*[=+\-@]|^[\t\r\n]/.test(value) ? `'${value}` : value
  downloadCsv(
    `${base}.csv`,
    ['行号', '字段', 'SKU', '原始行内容', '失败原因'],
    failures.map(f => [
      f.lineNo > 0 ? f.lineNo : '',
      asText(f.field || '整行'),
      asText(f.sku?.trim() ?? ''),
      asText(f.row?.trim() ?? ''),
      asText(userFacingError(f.reason, undefined, '该行导入失败，请核对文件内容后重试')),
    ]),
  )
}
