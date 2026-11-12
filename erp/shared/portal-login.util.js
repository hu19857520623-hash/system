"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PORTAL_LOGIN_PHONE_MAX = exports.PORTAL_LOGIN_PHONE_MIN = void 0;
exports.normalizePortalLoginPhone = normalizePortalLoginPhone;
exports.isValidPortalLoginPhone = isValidPortalLoginPhone;
exports.buildPortalLoginUsername = buildPortalLoginUsername;
exports.buildPortalLoginUsernameWithSuffix = buildPortalLoginUsernameWithSuffix;
exports.normalizePortalLoginIdentifier = normalizePortalLoginIdentifier;
exports.PORTAL_LOGIN_PHONE_MIN = 6;
exports.PORTAL_LOGIN_PHONE_MAX = 50;
function normalizePortalLoginPhone(value) {
    return String(value || '').replace(/\D/g, '');
}
function isValidPortalLoginPhone(value) {
    const digits = normalizePortalLoginPhone(value);
    return digits.length >= exports.PORTAL_LOGIN_PHONE_MIN && digits.length <= exports.PORTAL_LOGIN_PHONE_MAX;
}
function buildPortalLoginUsername(phone) {
    const digits = normalizePortalLoginPhone(phone);
    if (!isValidPortalLoginPhone(digits)) {
        throw new Error('联系电话须为至少 6 位数字');
    }
    return digits;
}
function buildPortalLoginUsernameWithSuffix(phone, customerCode) {
    const base = buildPortalLoginUsername(phone);
    const suffix = customerCode.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    const combined = `${base}${suffix}`;
    if (combined.length > exports.PORTAL_LOGIN_PHONE_MAX) {
        throw new Error('手机号与客户代码组合后的登录账号过长');
    }
    if (combined.length < exports.PORTAL_LOGIN_PHONE_MIN) {
        throw new Error('联系电话须为至少 6 位数字');
    }
    return combined;
}
/** Login identifiers with letters (e.g. omsadmin) stay as-is; phone-like input becomes digits. */
function normalizePortalLoginIdentifier(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (/[a-z]/.test(raw))
        return raw;
    const digits = normalizePortalLoginPhone(raw);
    if (isValidPortalLoginPhone(digits))
        return digits;
    return raw;
}
//# sourceMappingURL=portal-login.util.js.map