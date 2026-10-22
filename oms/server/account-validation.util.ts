type RequiredAccountFields = {
  customerName?: unknown
  contactEmail?: unknown
  contactPhone?: unknown
  omsType?: unknown
  warehouse?: unknown
  temporaryPassword?: unknown
}

/** 与开户表单的中文名称保持一致，不向客户暴露内部属性名。 */
export function missingRequiredAccountMessage(body: RequiredAccountFields): string | null {
  const required: [string, unknown][] = [
    ['客户名称', body.customerName], ['联系邮箱', body.contactEmail],
    ['联系电话', body.contactPhone], ['客户类型', body.omsType],
    ['仓库', body.warehouse], ['临时密码', body.temporaryPassword],
  ]
  const missing = required.find(([, value]) => !String(value || '').trim())
  return missing ? `缺少${missing[0]}` : null
}
