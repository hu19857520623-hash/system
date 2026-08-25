import { ElMessage, ElMessageBox } from 'element-plus'
import { h } from 'vue'
import { useAsyncIo } from './useAsyncIo'
import { erpConfirm } from '@/utils/messageBox'

type FieldList = [string, unknown][]

/**
 * 通用行内交互辅助：详情弹窗 / 提示 / 导出导入 / 确认操作。
 */
export function useRowActions() {
  const { exportModule, importCsv } = useAsyncIo()

  function showDetail(title: string, fields: FieldList) {
    const visible = fields.filter(([, value]) => value != null && String(value).trim() !== '')
    const content = h(
      'div',
      { class: 'row-detail-grid' },
      visible.map(([label, value]) => {
        const text = String(value)
        const wide = label === '备注' || text.length > 40 || text.includes('\n')
        return h('div', { class: ['row-detail-item', wide ? 'is-wide' : ''].filter(Boolean).join(' ') }, [
          h('span', { class: 'row-detail-label' }, label),
          h('span', { class: 'row-detail-value' }, text),
        ])
      }),
    )
    ElMessageBox.alert(content, title, {
      confirmButtonText: '关闭',
      customClass: 'row-detail-box',
      appendTo: document.body,
      draggable: true,
    })
  }

  const toast = (msg: string, type: 'success' | 'info' | 'warning' | 'error' = 'success') => ElMessage({ message: msg, type })

  const exportTask = (what = '数据') => exportModule(what)

  const importTask = (what = '数据') => importCsv(what === '线索' ? '线索' : what)

  async function confirmAction(message: string, title = '操作确认', type: 'warning' | 'info' = 'warning') {
    try {
      await erpConfirm(message, title, {
        type,
        confirmButtonText: '确认',
        cancelButtonText: '取消',
      })
      return true
    } catch {
      return false
    }
  }

  return { showDetail, toast, exportTask, importTask, confirmAction }
}
