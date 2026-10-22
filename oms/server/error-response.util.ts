import { userFacingError } from '../src/utils/userFacingError.js'

/** 保留响应结构和状态码，只规范展示给用户的错误提示。 */
export function localizedErrorResponse(body: unknown, status: number): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: userFacingError(body, status) }
  const source = body as Record<string, unknown>
  const result = { ...source }
  if ('error' in source) result.error = userFacingError(source.error, status)
  if ('message' in source) result.message = userFacingError(source.message, status)
  if (!('error' in source) && !('message' in source)) result.error = userFacingError(undefined, status)
  return result
}
