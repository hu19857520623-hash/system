/** 将接口和运行时异常转换为用户可处理的中文提示；原始异常留在服务端日志。 */
export function userFacingError(value: unknown, status?: number, fallback = '操作失败，请稍后重试'): string {
  const defaults: Record<number, string> = {
    400: '输入信息有误，请检查后重试', 401: '登录已失效，请重新登录',
    403: '没有权限执行此操作，请联系管理员', 404: '未找到所需记录，请刷新后重试',
    405: '当前操作暂不支持，请刷新页面后重试', 408: '请求超时，请稍后重试',
    409: '数据已发生变化或存在重复，请刷新后重试', 413: '文件过大，请缩小文件后重试',
    422: '输入信息不符合要求，请检查后重试', 429: '操作过于频繁，请稍后再试',
    500: '服务处理失败，请稍后重试；如持续失败，请联系管理员',
    502: '服务暂时无法连接，请稍后重试', 503: '服务暂时不可用，请稍后重试',
    504: '服务响应超时，请稍后重试',
  }
  const safeFallback = defaults[status || 0] || fallback
  if (Array.isArray(value)) {
    return [...new Set(value.map(item => userFacingError(item, status, fallback)))].join('；') || safeFallback
  }
  if (value && typeof value === 'object' && !(value instanceof Error)) {
    const body = value as { message?: unknown; error?: unknown }
    return userFacingError(body.message ?? body.error, status, fallback)
  }
  const text = (value instanceof Error ? value.message : typeof value === 'string' ? value : '').trim().replace(/^Error:\s*/i, '')
  if (!text) return safeFallback
  if (text.startsWith('{') || text.startsWith('[')) {
    try { return userFacingError(JSON.parse(text), status, fallback) } catch { /* 非 JSON 业务提示继续按文本处理。 */ }
  }
  const context = text.match(/^([^\n]{0,140}?[\u3400-\u9fff][^\n]{0,100}?)[：:]\s*[A-Za-z<]/)?.[1]
  const contextual = (message: string) => context && !/https?:|127\.0\.0\.1|localhost|[`<>]/i.test(context) ? `${context}：${message}` : message
  const detail = context ? text.slice(context.length).replace(/^[：:]\s*/, '') : text
  // Match the whole stock HTTP message before translating its suffix, including an older partially localized response.
  if (/^(?:(?:resource|record|document|entity)\s+)?(?:not found|未找到所需记录)[.!。]?$/i.test(detail)) return contextual(defaults[404])
  // SQL、堆栈和网关页面不属于业务提示，即使带中文前缀也不能直接展示。
  if (/PrismaClient|Invalid `|SQLSTATE|\bat\s+\S+\s*\([^)]*:\d+:\d+|<!doctype|<html|ECONN\w+|ENOTFOUND|ENETUNREACH/i.test(text)) return contextual(safeFallback)
  if (/failed to fetch|fetch failed|network\s*error|networkerror|load failed/i.test(text)) return contextual('网络连接失败，请检查网络后重试')
  if (/timeout|timed out|AbortError|operation was aborted/i.test(text)) return contextual('请求超时或已中断，请刷新列表确认操作结果后再试')
  if (/unexpected token|unexpected end|invalid json|JSON\.parse|cannot read propert|is not a function/i.test(text)) return contextual('数据处理失败，请刷新后重试；如持续失败，请联系管理员')
  const replacements: Array<[RegExp, string]> = [
    [/\bUnauthorized\b/gi, '登录已失效，请重新登录'], [/\bForbidden\b/gi, '没有权限执行此操作'],
    [/\bBad Request\b/gi, '输入信息有误，请检查后重试'], [/\bNot Found\b/gi, '未找到所需记录'],
    [/\bInternal Server Error\b/gi, defaults[500]], [/\bBad Gateway\b/gi, defaults[502]],
    [/\bService Unavailable\b/gi, defaults[503]], [/\bGateway Timeout\b/gi, defaults[504]],
    [/\bToo Many Requests\b/gi, defaults[429]],
  ]
  let localized = text
  for (const [pattern, replacement] of replacements) localized = localized.replace(pattern, replacement)
  if (/must be|should not|is required|must not|invalid enum|validation failed/i.test(localized)) return defaults[400]
  if (/\b(?:error|exception|failed|failure|undefined|null|invalid|ENOENT|EACCES)\b/i.test(localized)) return contextual(safeFallback)
  if (!/[\u3400-\u9fff]/.test(localized)) return safeFallback
  return localized
}
