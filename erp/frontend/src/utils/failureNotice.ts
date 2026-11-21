import type { MessageOptionsWithType, MessageParamsWithType } from 'element-plus'
import { isVNode } from 'vue'

export function failureNotice(input?: MessageParamsWithType): MessageOptionsWithType {
  const options = !input || typeof input === 'string' || typeof input === 'function' || isVNode(input)
    ? { message: input }
    : input
  const customClass = ['erp-failure-notice', options.customClass].filter(Boolean).join(' ')
  const duration = options.duration
  return {
    ...options,
    duration: duration && duration > 0 && Number.isFinite(duration) ? duration : 5000,
    showClose: true,
    grouping: options.grouping ?? true,
    customClass,
  }
}
