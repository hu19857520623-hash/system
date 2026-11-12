export declare const PORTAL_LOGIN_PHONE_MIN = 6;
export declare const PORTAL_LOGIN_PHONE_MAX = 50;
export declare function normalizePortalLoginPhone(value: unknown): string;
export declare function isValidPortalLoginPhone(value: unknown): boolean;
export declare function buildPortalLoginUsername(phone: unknown): string;
export declare function buildPortalLoginUsernameWithSuffix(phone: unknown, customerCode: string): string;
/** Login identifiers with letters (e.g. omsadmin) stay as-is; phone-like input becomes digits. */
export declare function normalizePortalLoginIdentifier(value: unknown): string;
