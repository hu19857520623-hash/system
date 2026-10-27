import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { userFacingError } from '@erp/shared/user-facing-error'
import { purchaseApi } from '@/api/client.js'
import { pickFile } from '@/composables/useAsyncIo'
import { downloadCsv, downloadRequiredFieldsExcel, normalizeImportFileText } from '@/utils/csv'

export interface PrePurchaseInfoFailure {
  lineNo: number
  prePoNo: string
  field: string
  value: string
  reason: string
}

export function usePrePurchaseInfo(reload: () => Promise<void>) {
  const busy = ref(false)
  const selected = ref<{ id: number }[]>([])
  const failures = ref<PrePurchaseInfoFailure[]>([])
  const failedRows = ref(0)
  const failureVisible = ref(false)

  async function exportInfo() {
    if (busy.value) return
    if (!selected.value.length) { ElMessage.warning('请先勾选需要导出的预采购单'); return }
    const ids = selected.value.map(row => row.id)
    busy.value = true
    try {
      const result = await purchaseApi.exportPrePoInfo(ids)
      downloadRequiredFieldsExcel(`预采购单信息_${new Date().toLocaleDateString('sv-SE')}.xls`, result.headers, result.rows)
      ElMessage.success(`已导出选中的 ${result.total} 张预采购单，红色单元格为必填项`)
    } catch (error) { ElMessage.error(`导出信息失败。${userFacingError(error)}`) }
    finally { busy.value = false }
  }

  async function importInfo() {
    if (busy.value) return
    busy.value = true
    let submitted = false
    try {
      const file = await pickFile('.csv,.xls')
      if (!file) return
      const content = normalizeImportFileText(await file.text())
      failures.value = []
      failedRows.value = 0
      failureVisible.value = false
      submitted = true
      const result = await purchaseApi.importPrePoInfo(content)
      if (result.failures?.length) {
        failures.value = result.failures
        failedRows.value = result.failed
        failureVisible.value = true
        ElMessage.error(`校验未通过：${result.failed} 行、${result.failures.length} 处错误，整批未更新`)
        return
      }
      ElMessage.success(`导入信息完成：已更新 ${result.updated} 张预采购单`)
      await reload()
    } catch (error) {
      const status = Number((error as { status?: unknown })?.status)
      const uncertain = submitted && (!Number.isFinite(status) || status >= 500 || status === 408 || status === 409)
      ElMessage.error((uncertain ? '导入结果暂无法确认，请刷新列表或重新导出核对后再操作。' : '导入信息失败。') + userFacingError(error))
    } finally { busy.value = false }
  }

  function downloadFailures() {
    downloadCsv('预采购单信息_校验错误明细.csv', ['行号', '预采购单号', '字段', '填写值', '错误原因'],
      failures.value.map(item => [item.lineNo, item.prePoNo, item.field, item.value, item.reason]))
  }

  return { busy, selected, failures, failedRows, failureVisible, exportInfo, importInfo, downloadFailures }
}
