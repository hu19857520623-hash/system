export interface ImportRowFailure {
  lineNo: number
  reason: string
  /** 商品 SKU 等行级标识（有则展示） */
  sku?: string
}

export interface ImportRowResult {
  imported: number
  failed: number
  failures: ImportRowFailure[]
}

export const MAX_IMPORT_FAILURE_DETAILS = 200

export function serializeImportResultDetail(failures: ImportRowFailure[]): string | null {
  if (!failures.length) return null
  return JSON.stringify({
    failures: failures.slice(0, MAX_IMPORT_FAILURE_DETAILS),
  })
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
