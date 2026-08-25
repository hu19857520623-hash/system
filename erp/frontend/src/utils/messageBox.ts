import { ElMessageBox, type ElMessageBoxOptions, type MessageBoxData } from 'element-plus'

const COMPACT = 'erp-compact-box'

type BoxOptions = ElMessageBoxOptions

function baseOptions(customClass?: string): BoxOptions {
  return {
    appendTo: document.body,
    customClass: customClass || COMPACT,
    confirmButtonText: '确定',
    cancelButtonText: '取消',
  }
}

function mergeClass(base: string, extra?: string) {
  return [base, extra].filter(Boolean).join(' ')
}

/** 紧凑型确认框（替代 ElMessageBox.confirm） */
export function erpConfirm(message: string, title: string, options?: BoxOptions) {
  return ElMessageBox.confirm(message, title, {
    ...baseOptions(),
    type: 'warning',
    ...options,
    customClass: mergeClass(COMPACT, options?.customClass),
  })
}

/** 紧凑型输入框（替代 ElMessageBox.prompt） */
export function erpPrompt(message: string, title: string, options?: BoxOptions): Promise<MessageBoxData> {
  return ElMessageBox.prompt(message, title, {
    ...baseOptions('erp-prompt-box'),
    ...options,
    customClass: mergeClass(`${COMPACT} erp-prompt-box`, options?.customClass),
  })
}

/** 紧凑型提示框（替代 ElMessageBox.alert） */
export function erpAlert(message: string, title: string, options?: BoxOptions) {
  return ElMessageBox.alert(message, title, {
    ...baseOptions(),
    ...options,
    customClass: mergeClass(COMPACT, options?.customClass),
  })
}
