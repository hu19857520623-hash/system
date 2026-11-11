type NoticeOptions = { message?: unknown; duration?: number; showClose?: boolean; customClass?: string }

/** 失败提示保留到用户关闭，避免几秒后丢失恢复说明。 */
export function persistentFailureNotice(input: unknown): NoticeOptions & { duration: 0; showClose: true } {
  const options: NoticeOptions = typeof input === 'string'
    ? { message: input }
    : input && typeof input === 'object'
      ? { ...(input as NoticeOptions) }
      : { message: input == null ? '' : String(input) }
  const customClass = ['erp-failure-notice', options.customClass].filter(Boolean).join(' ')
  return { ...options, duration: 0, showClose: true, customClass }
}
