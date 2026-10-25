import { userFacingError } from '@erp/shared/user-facing-error'
import { downloadCsv } from '@/utils/csv.ts'

export type ImportRowFailure = {
  lineNo: number
  reason: string
  sku?: string
}

export function formatImportFailureLine(f: ImportRowFailure): string {
  const skuPart = f.sku?.trim() ? ` · SKU ${f.sku.trim()}` : ''
  const lineLabel = f.lineNo > 0 ? String(f.lineNo) : '—'
  return `第 ${lineLabel} 行${skuPart}：${userFacingError(f.reason, undefined, '该行导入失败，请核对文件内容后重试')}`
}

export function downloadImportFailuresCsv(filename: string, failures: ImportRowFailure[]) {
  if (!failures.length) return
  const base = filename.replace(/\.csv$/i, '')
  downloadCsv(
    `${base}.csv`,
    ['行号', 'SKU', '失败原因'],
    failures.map(f => [
      f.lineNo > 0 ? f.lineNo : '',
      f.sku?.trim() ?? '',
      userFacingError(f.reason, undefined, '该行导入失败，请核对文件内容后重试'),
    ]),
  )
}
