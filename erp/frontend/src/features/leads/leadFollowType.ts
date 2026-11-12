const FOLLOW_TYPE_LABELS: Record<string, string> = {
  phone: '电话',
  wechat: '微信',
  wecom: '企微',
  email: '邮件',
  visit: '拜访',
  other: '其他',
}

export function leadFollowTypeLabel(value?: string | null): string {
  return value ? FOLLOW_TYPE_LABELS[value] || value : '未填写'
}
