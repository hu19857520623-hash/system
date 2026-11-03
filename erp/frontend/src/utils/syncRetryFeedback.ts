export function syncRetryFeedback(result: { status?: string; message?: string } | null | undefined) {
  const success = result?.status === 'success'
  return { success, message: result?.message || (success ? '同步已确认成功' : '同步尚未确认成功，请核对日志后再重试') }
}
