export const PORTAL_LOGIN_PHONE_MIN = 6
export const PORTAL_LOGIN_PHONE_MAX = 50

export function normalizePortalLoginPhone(value: unknown): string {
  return String(value || '').replace(/\D/g, '')
}

export function isValidPortalLoginPhone(value: unknown): boolean {
  const digits = normalizePortalLoginPhone(value)
  return digits.length >= PORTAL_LOGIN_PHONE_MIN && digits.length <= PORTAL_LOGIN_PHONE_MAX
}

export function buildPortalLoginUsername(phone: unknown): string {
  const digits = normalizePortalLoginPhone(phone)
  if (!isValidPortalLoginPhone(digits)) {
    throw new Error('联系电话须为至少 6 位数字')
  }
  return digits
}

export function buildPortalLoginUsernameWithSuffix(
  phone: unknown,
  customerCode: string,
): string {
  const base = buildPortalLoginUsername(phone)
  const suffix = customerCode.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')
  const combined = `${base}${suffix}`
  if (combined.length > PORTAL_LOGIN_PHONE_MAX) {
    throw new Error('手机号与客户代码组合后的登录账号过长')
  }
  if (combined.length < PORTAL_LOGIN_PHONE_MIN) {
    throw new Error('联系电话须为至少 6 位数字')
  }
  return combined
}

/** Login identifiers with letters (e.g. omsadmin) stay as-is; phone-like input becomes digits. */
export function normalizePortalLoginIdentifier(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase()
  if (/[a-z]/.test(raw)) return raw
  const digits = normalizePortalLoginPhone(raw)
  if (isValidPortalLoginPhone(digits)) return digits
  return raw
}
