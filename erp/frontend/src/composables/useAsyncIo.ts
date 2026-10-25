
import { userFacingError } from '@erp/shared/user-facing-error'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { asyncIoApi, triggerBrowserDownload } from '@/api/client.js'
import { normalizeImportFileText } from '@/utils/csv'
import { showImportResultFeedback } from '@/utils/importResultFeedback.ts'

export function triggerBlobDownload(blob: Blob, fileName: string) {
  triggerBrowserDownload(blob, fileName)
}

export function pickFile(accept = '.csv,.xls'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

export function useAsyncIo() {
  const route = useRoute()
  const router = useRouter()
  const exportBusy = ref(false)
  async function exportModule(module: string, params?: Record<string, unknown>) {
    if (exportBusy.value) return null
    exportBusy.value = true
    const returnTo = route.fullPath
    try {
      const job = await asyncIoApi.export({ module, params })
      const completed = job.status === 'completed'
      if (route.path === '/async-io') {
        if (completed) ElMessage.success('导出已完成，可下载文件')
        else ElMessage.error(userFacingError(job.errorMessage || '导出失败，请查看任务详情'))
      } else {
        try {
          await ElMessageBox.confirm(completed ? '导出已完成。可前往任务列表下载文件，或返回当前页面继续操作。' : '导出失败。可前往任务列表查看原因并按原筛选重试。', '导出结果', { confirmButtonText: '查看任务', cancelButtonText: '返回当前页面', type: completed ? 'success' : 'warning' })
          await router.push({ path: '/async-io', query: { tab: 'export', returnTo, jobId: String(job.id) } })
        } catch { /* 用户关闭结果提示，保留原页面。 */ }
      }
      return job
    } catch (e: any) {
      ElMessage.error(userFacingError(e.message || '导出失败') + '；请刷新任务列表核对结果后再试')
      return null
    } finally { exportBusy.value = false }
  }

  async function importCsv(module: string, file?: File) {
    const f = file ?? (await pickFile())
    if (!f) return null
    try {
      const content = normalizeImportFileText(await f.text())
      const job = await asyncIoApi.import({ module, fileName: f.name, content })
      await showImportResultFeedback(job)
      return job
    } catch (e: any) {
      ElMessage.error(userFacingError(e.message || '导入失败'))
      return null
    }
  }

  async function downloadJob(jobId: number | string, fileName?: string) {
    try {
      const { blob, fileName: fn } = await asyncIoApi.download(jobId)
      triggerBlobDownload(blob, fileName || fn)
      ElMessage.success('下载已开始')
    } catch (e: any) {
      ElMessage.error(userFacingError(e.message || '下载失败'))
    }
  }

  return { exportModule, exportBusy, importCsv, downloadJob, pickFile, triggerBlobDownload }
}
