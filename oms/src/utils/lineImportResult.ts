import type { ImportRowFailure } from './importFailureDetail'
import { failuresFromLegacyErrors, showImportFailuresDialog } from './importFailureDetail'

export type LineImportParseResult = {
  data: unknown[]
  errors: string[]
  failures?: ImportRowFailure[]
}

export function resolveImportFailures(result: LineImportParseResult): ImportRowFailure[] {
  if (result.failures?.length) return result.failures
  return failuresFromLegacyErrors(result.errors)
}

export type LineImportResultOptions = {
  /** 全部成功或部分成功写入后的提示（默认：已读取 N 行明细…） */
  successMessage?: (acceptedCount: number) => string
  /** 无有效行且无失败行时的提示 */
  emptyMessage?: string
  /** 下载失败明细 CSV 文件名（不含扩展名） */
  csvFilename?: string
}

/** 表单/批量 CSV 导入：支持部分成功，展示行号 / SKU / 原因并可下载 */
export async function reportLineImportResult(
  result: LineImportParseResult,
  onAcceptedRows: () => void | Promise<void>,
  options?: LineImportResultOptions,
): Promise<boolean> {
  const failures = resolveImportFailures(result)
  const ok = result.data.length
  const fail = failures.length
  const successMsg = options?.successMessage ?? ((n: number) => `已读取 ${n} 行明细，请核对后提交`)

  if (ok === 0 && fail === 0) {
    window.alert(options?.emptyMessage ?? '未解析到有效明细，请使用最新模板')
    return false
  }

  if (fail === 0) {
    await onAcceptedRows()
    window.alert(successMsg(ok))
    return true
  }

  if (ok > 0) {
    await onAcceptedRows()
    showImportFailuresDialog(
      `部分行未导入：成功 ${ok} 行，失败 ${fail} 行`,
      failures,
      options?.csvFilename,
    )
    return true
  }

  showImportFailuresDialog(`导入失败：${fail} 行未通过校验`, failures, options?.csvFilename)
  return false
}
