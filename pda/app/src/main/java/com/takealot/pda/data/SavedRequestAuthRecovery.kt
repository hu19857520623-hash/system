package com.takealot.pda.data

internal val ErpException.isAuthorizationFailure: Boolean get() = code == 401 || code == 403

/** A prepared mutation can resume after the original account regains access. */
internal suspend fun <T> withSavedRequestAuthRecovery(action: suspend () -> T): T {
    return try {
        action()
    } catch (e: ErpException) {
        if (!e.isAuthorizationFailure || e.retriable) throw e
        val message = if (e.code == 401) "请使用原账号重新登录，再到「待同步记录」重试原请求"
            else "当前账号没有操作权限。权限恢复后，请到「待同步记录」重试原请求"
        throw ErpException(message, e.code, retriable = true)
    }
}
