import { ElMessage, ElMessageBox } from 'element-plus'
import { h } from 'vue'
import { useAsyncIo } from './useAsyncIo'

type FieldList = [string, unknown][]

/**
 * 通用行内交互辅助：详情弹窗 / 提示 / 导出导入 / 确认操作。
 */
export function useRowActions() {
  const { exportModule, importCsv } = useAsyncIo()

  function showDetail(title: string, fields: FieldList) {
    const content = h(
      'div',
      { class: 'row-detail-grid' },
      fields.map(([label, value]) =>
        h('div', { class: 'row-detail-item' }, [
          h('span', { class: 'row-detail-label' }, label),
          h('span', { class: 'row-detail-value' }, value == null ? '' : String(value)),
        ]),
      ),
    )
    ElMessageBox.alert(content, title, {
      confirmButtonText: '关闭',
      customClass: 'row-detail-box',
      appendTo: document.body,
    })
  }

  const toast = (msg: string, type: 'success' | 'info' | 'warning' | 'error' = 'success') => ElMessage({ message: msg, type })

  const exportTask = (what = '数据') => exportModule(what)

  const importTask = (what = '数据') => importCsv(what === '线索' ? '线索' : what)

  async function confirmAction(message: string, title = '操作确认', type: 'warning' | 'info' = 'warning') {
    try {
      await ElMessageBox.confirm(message, title, {
        type,
        confirmButtonText: '确认',
        cancelButtonText: '取消',
        appendTo: document.body,
      })
      return true
    } catch {
      return false
    }
  }

  return { showDetail, toast, exportTask, importTask, confirmAction }
}
