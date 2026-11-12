export type PageConfirmOptions = {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** 仅展示一个关闭按钮（用于告知类信息，不执行动作） */
  noticeOnly?: boolean
}

type ConfirmHandler = (options: PageConfirmOptions) => Promise<boolean>

let handler: ConfirmHandler | null = null

/** 由 PageConfirmProvider 在挂载时注册；卸载时清除。 */
export function registerPageConfirm(next: ConfirmHandler): () => void {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

/**
 * 页内确认替代原生 window.confirm：返回 true 表示用户确认。
 * 没有挂载宿主时安全默认为取消（不执行危险动作），不回退到原生弹窗。
 */
export function pageConfirm(options: PageConfirmOptions): Promise<boolean> {
  if (!handler) return Promise.resolve(false)
  return handler(options)
}

/** 页内提示替代原生 window.alert（仅展示与关闭，不执行动作）。 */
export function pageNotice(message: string, title = '提示'): void {
  void pageConfirm({ title, message, noticeOnly: true })
}
