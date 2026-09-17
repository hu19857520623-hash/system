import { ElMessage, ElMessageBox } from 'element-plus'
import { h } from 'vue'
import {
  downloadImportFailuresCsv,
  formatImportFailureLine,
  type ImportRowFailure,
} from '@/utils/importFailureDetail.ts'

export type { ImportRowFailure }

export type ImportJobResult = {
  imported?: number
  failed?: number
  processedRows?: number
  failedRows?: number
  failures?: ImportRowFailure[]
  resultDetail?: string | null
}

export function parseImportFailures(job: ImportJobResult | null | undefined): ImportRowFailure[] {
  if (!job) return []
  if (Array.isArray(job.failures) && job.failures.length) return job.failures
  const raw = job.resultDetail
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as { failures?: ImportRowFailure[] }
    return Array.isArray(parsed.failures) ? parsed.failures : []
  } catch {
    return []
  }
}

export function importCounts(job: ImportJobResult | null | undefined) {
  const imported = job?.imported ?? job?.processedRows ?? 0
  const failed = job?.failed ?? job?.failedRows ?? 0
  return { imported, failed }
}

function failureListVNode(failures: ImportRowFailure[]) {
  const lines = failures.slice(0, 50).map(formatImportFailureLine)
  const more = failures.length > 50 ? `\n…另有 ${failures.length - 50} 条未展示` : ''
  return h(
    'pre',
    {
      style: {
        margin: '8px 0 0',
        padding: '10px 12px',
        maxHeight: '240px',
        overflow: 'auto',
        fontSize: '12px',
        lineHeight: '1.5',
        whiteSpace: 'pre-wrap',
        background: 'var(--el-fill-color-light)',
        borderRadius: '8px',
      },
    },
    lines.join('\n') + more,
  )
}

/** 按成功/失败数量选择提示类型；有失败明细时弹出详情 */
export async function showImportResultFeedback(job: ImportJobResult | null | undefined) {
  if (!job) return
  const { imported, failed } = importCounts(job)
  const failures = parseImportFailures(job)
  const summary = `导入完成：成功 ${imported} 条${failed ? `，失败 ${failed} 条` : ''}`

  if (failed > 0 && imported === 0) {
    ElMessage.error(summary)
  } else if (failed > 0) {
    ElMessage.warning(summary)
  } else {
    ElMessage.success(summary)
  }

  if (failed > 0 && failures.length > 0) {
    await showImportFailuresDialog(summary, failures)
  }
}

/** 展示行号 / SKU / 原因，并支持下载失败明细 CSV */
export async function showImportFailuresDialog(
  summary: string,
  failures: ImportRowFailure[],
  csvFilename = '导入失败明细',
) {
  if (!failures.length) {
    ElMessage.info(summary)
    return
  }
  try {
    await ElMessageBox.confirm(
      h('div', {}, [
        h('p', { style: { margin: 0, fontSize: '13px' } }, summary),
        failureListVNode(failures),
      ]),
      '导入失败明细',
      {
        confirmButtonText: '关闭',
        cancelButtonText: '下载失败明细',
        distinguishCancelAndClose: true,
        customClass: 'row-detail-box',
      },
    )
  } catch (action) {
    if (action === 'cancel') {
      downloadImportFailuresCsv(csvFilename, failures)
    }
  }
}

export function toastImportOutcome(imported: number, failed: number, moduleLabel = '导入') {
  const summary = `${moduleLabel}完成：成功 ${imported} 条${failed ? `，失败 ${failed} 条` : ''}`
  if (failed > 0 && imported === 0) ElMessage.error(summary)
  else if (failed > 0) ElMessage.warning(summary)
  else ElMessage.success(summary)
}

export type PartialImportResultOptions = {
  emptyMessage?: string
  successMessage?: (acceptedCount: number) => string
  moduleLabel?: string
  csvFilename?: string
}

/** 与 OMS reportLineImportResult 对齐：部分成功写入 + 统一失败弹窗 */
export async function reportPartialImportResult(
  acceptedCount: number,
  failures: ImportRowFailure[],
  onAccepted?: () => void | Promise<void>,
  options?: PartialImportResultOptions,
): Promise<boolean> {
  const fail = failures.length
  const label = options?.moduleLabel ?? '导入'
  const successMsg = options?.successMessage ?? ((n: number) => `${label}完成：已处理 ${n} 条`)

  if (acceptedCount === 0 && fail === 0) {
    ElMessage.warning(options?.emptyMessage ?? '未解析到有效数据，请使用最新模板')
    return false
  }

  if (fail === 0) {
    await onAccepted?.()
    const msg = successMsg(acceptedCount)
    if (options?.moduleLabel === '明细导入') ElMessage.info(msg)
    else ElMessage.success(msg)
    return true
  }

  if (acceptedCount > 0) {
    await onAccepted?.()
    toastImportOutcome(acceptedCount, fail, label)
    await showImportFailuresDialog(
      `部分行未导入：成功 ${acceptedCount} 条，失败 ${fail} 条`,
      failures,
      options?.csvFilename,
    )
    return true
  }

  toastImportOutcome(0, fail, label)
  await showImportFailuresDialog(`导入失败：${fail} 条未通过校验`, failures, options?.csvFilename)
  return false
}

export function formatImportDetailFields(job: Record<string, unknown>) {
  const imported = Number(job.processedRows ?? 0)
  const failed = Number(job.failedRows ?? 0)
  const failures = parseImportFailures(job as ImportJobResult)
  const failureText = failures.length
    ? failures.slice(0, 80).map(formatImportFailureLine).join('\n')
      + (failures.length > 80 ? `\n…另有 ${failures.length - 80} 条，可在详情中下载完整 CSV` : '')
    : failed > 0 ? '（无行级明细，请查看服务端日志）' : '—'

  return [
    ['任务编号', job.jobNo],
    ['导入类型', job.module],
    ['文件名', job.fileName],
    ['成功', imported],
    ['失败', failed],
    ['状态', job.status],
    ['时间', job.createdAt],
    ['失败明细', failureText],
  ] as [string, unknown][]
}
