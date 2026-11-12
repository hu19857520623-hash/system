export function requestStillPending(status: number) {
  return !Number.isFinite(status) || status < 100 || status >= 500 || status === 401 || status === 403 || status === 408 || status === 409 || status === 429
}

export function pendingActionNotice(status: number, action: string) {
  if (status === 401) return `登录已失效，${action}结果尚未确认。请使用原账号重新登录后重新读取单据，不要重复提交。`
  if (status === 403) return `当前岗位无法确认${action}。请恢复原岗位权限后重新读取单据，不要更换账号重复提交。`
  if (status === 429) return `请求过于频繁，${action}结果尚未确认。请稍后再重新读取单据，不要重复提交。`
  if (requestStillPending(status)) return `${action}结果暂无法确认。请重新读取单据核对后再继续，不要重复提交。`
  return ''
}

export function attachmentUploadFailure(status: number, message: string) {
  const mismatch = status === 409 && (message.includes('不要修改后重试') || message.includes('内容不同') || message.includes('结束本次'))
  if (mismatch) return { clear: false, mismatch: true, text: '原附件内容不同。请结束本次后再重新选择，不要修改后重试。' }
  if (status === 401) return { clear: false, mismatch: false, text: '登录已失效，原附件已保留。请重新登录后用同一个文件重试，不要另选一份。' }
  if (status === 403) return { clear: false, mismatch: false, text: '当前岗位无法核对原附件，原请求已保留。请恢复原岗位权限后用同一个文件重试，不要另选一份。' }
  if (status === 429) return { clear: false, mismatch: false, text: '请求过于频繁，原附件已保留。请稍后再用同一个文件重试，不要另选一份。' }
  if (!Number.isFinite(status) || status >= 500 || status === 408) return { clear: false, mismatch: false, text: '附件上传结果尚未确认。请用同一个文件重试，不要另选一份。' }
  return { clear: true, mismatch: false, text: '' }
}

export function imageUploadFailure(status: number, message: string) {
  const mismatch = status === 409 && (message.includes('不要修改后重试') || message.includes('内容不同') || message.includes('结束本次'))
  if (mismatch) return { clear: false, mismatch: true, text: '原图片内容不同。请结束本次后再重新选择，不要修改后重试。' }
  if (status === 409 && (message.includes('状态已变化') || message.includes('请刷新'))) return { clear: true, mismatch: false, text: '商品图片状态已变化。请刷新商品后再选择图片，不要重试刚才这次上传。' }
  if (status === 401) return { clear: false, mismatch: false, text: '登录已失效，原图片已保留。请重新登录后用同一张图片重试，不要另选一张。' }
  if (status === 403) return { clear: false, mismatch: false, text: '当前岗位无法核对原图片，原请求已保留。请恢复原岗位权限后用同一张图片重试，不要另选一张。' }
  if (status === 429) return { clear: false, mismatch: false, text: '请求过于频繁，原图片已保留。请稍后再用同一张图片重试，不要另选一张。' }
  if (!Number.isFinite(status) || status >= 500 || status === 408 || status === 409) return { clear: false, mismatch: false, text: '图片上传结果尚未确认。请用同一张图片重试，不要另选一张。' }
  return { clear: true, mismatch: false, text: '' }
}
