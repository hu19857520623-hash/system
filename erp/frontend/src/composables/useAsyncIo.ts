import { ElMessage } from 'element-plus'
import { asyncIoApi } from '@/api/client.js'
import { normalizeImportFileText } from '@/utils/csv'

export function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export function pickFile(accept = '.csv,.xls'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}

export function useAsyncIo() {
  async function exportModule(module: string, params?: Record<string, unknown>) {
    try {
      const job = await asyncIoApi.export({ module, params })
      ElMessage.success(`${module}导出已完成，可在「异步导出导入」中下载`)
      return job
    } catch (e: any) {
      ElMessage.error(e.message || '导出失败')
      return null
    }
  }

  async function importCsv(module: string, file?: File) {
    const f = file ?? (await pickFile())
    if (!f) return null
    try {
      const content = normalizeImportFileText(await f.text())
      const job = await asyncIoApi.import({ module, fileName: f.name, content })
      const imported = job?.imported ?? job?.processedRows ?? 0
      const failed = job?.failed ?? job?.failedRows ?? 0
      ElMessage.success(`导入完成：成功 ${imported} 条${failed ? `，失败 ${failed} 条` : ''}`)
      return job
    } catch (e: any) {
      ElMessage.error(e.message || '导入失败')
      return null
    }
  }

  async function downloadJob(jobId: number | string, fileName?: string) {
    try {
      const { blob, fileName: fn } = await asyncIoApi.download(jobId)
      triggerBlobDownload(blob, fileName || fn)
      ElMessage.success('下载已开始')
    } catch (e: any) {
      ElMessage.error(e.message || '下载失败')
    }
  }

  return { exportModule, importCsv, downloadJob, pickFile, triggerBlobDownload }
}
