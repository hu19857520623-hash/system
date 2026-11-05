export function syncRetryFeedback(result: { status?: string; message?: string; responseBody?: { message?: string } } | null | undefined) {
  const success = result?.status === 'success'
  return { success, message: result?.message || result?.responseBody?.message || (success ? '同步已确认成功' : '同步尚未确认成功，请核对日志后再重试') }
}
