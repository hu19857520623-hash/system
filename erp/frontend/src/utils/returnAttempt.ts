export function returnAttemptOutcome(status: number, message: string) {
  const mismatch = ['内容已变化', '不要修改后', '与原单不同', '内容不同'].some(part => message.includes(part))
  const statusChanged = !mismatch && (message.includes('状态已变化') || message.includes('请重新读取最新') || message.includes('已核对结束'))
  const contentChanged = status === 409 && mismatch
  const holdReason = !statusChanged && !contentChanged
    ? status === 401 ? 'login' : status === 403 ? 'permission' : status === 429 ? 'throttle' : null
    : null
  const uncertain = !statusChanged && (contentChanged || !!holdReason || !Number.isFinite(status) || status < 100 || status >= 500 || status === 408 || status === 409)
  return { uncertain, contentChanged, statusChanged, holdReason }
}

export function returnAttemptMessage(action: string, outcome: { uncertain: boolean; contentChanged: boolean; holdReason?: 'login' | 'permission' | 'throttle' | null }) {
  if (outcome.contentChanged) return `同一次${action}的内容已变化。请刷新核对原内容，不要修改后重复提交。若最新单据没有变化，请结束本次操作后再重新填写。`
  if (outcome.holdReason === 'login') return `登录已失效，原${action}已保留。请使用原账号重新登录后再提交，系统会沿用同一次操作。`
  if (outcome.holdReason === 'permission') return `当前岗位无法核对原${action}，原请求已保留。请恢复原岗位权限后再提交，不要更换账号重新填写。`
  if (outcome.holdReason === 'throttle') return `请求过于频繁，原${action}已保留。请稍后再提交，系统会沿用同一次操作。`
  if (outcome.uncertain) return `${action}结果暂无法确认。请先刷新核对；若尚未入账，请再次提交，系统会沿用同一次操作。已核对后可结束本次操作。`
  return ''
}
