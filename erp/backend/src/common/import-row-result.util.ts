export interface ImportRowFailure {
  lineNo: number
  field?: string
  reason: string
  /** 商品 SKU 等行级标识（有则展示） */
  sku?: string
  /** 原始行内容（截断保留）：任务详情与失败明细下载可恢复失败行 */
  row?: string
}

export interface ImportRowResult {
  imported: number
  failed: number
  failures: ImportRowFailure[]
}

export const MAX_IMPORT_FAILURE_DETAILS = 200

export function serializeImportResultDetail(failures: ImportRowFailure[]): string | null {
  if (!failures.length) return null
  const retained: string[] = []
  let bytes = 0
  for (const failure of failures.slice(0, MAX_IMPORT_FAILURE_DETAILS)) {
    const encoded = JSON.stringify(failure)
    bytes += Buffer.byteLength(encoded, 'utf8') + 1
    if (bytes > 60_000) break
    retained.push(encoded)
  }
  return `{"failures":[${retained.join(',')}],"failureDetailCount":${failures.length}}`
}

export function parseImportResultDetail(raw: string | null | undefined): ImportRowFailure[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as { failures?: ImportRowFailure[] } | ImportRowFailure[]
    if (Array.isArray(parsed)) return parsed
    if (Array.isArray(parsed.failures)) return parsed.failures
  } catch {
    /* legacy plain-text errorMessage */
  }
  return []
}
