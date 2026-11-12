package com.takealot.pda.data

internal val ErpException.isAuthorizationFailure: Boolean get() = code == 401 || code == 403

/** A prepared mutation can resume after the original account regains access. */
internal suspend fun <T> withSavedRequestAuthRecovery(action: suspend () -> T): T {
    return try {
        action()
    } catch (e: ErpException) {
        if (!e.isAuthorizationFailure || e.retriable) throw e
        throw ErpException(savedRequestAuthMessage(e.code), e.code, retriable = true)
    }
}


private fun savedRequestAuthMessage(code: Int): String =
    if (code == 401) "请使用原账号重新登录，再到「待同步记录」重试原请求"
    else "当前账号没有操作权限。权限恢复后，请到「待同步记录」重试原请求"

/** Older builds saved authorization refusals as final failures. Only recover intact original requests. */
internal fun PdaScanRecord.restoreLegacyAuthorizationFailure(): PdaScanRecord {
    if (state != "failed" || (ownerId ?: 0) <= 0 || serverUrl.isNullOrBlank()) return this
    val code = when (message) {
        "登录已过期，请重新登录",
        "登录已过期，请重新登录后继续未完成作业",
        erpFailureMessage(null, 401) -> 401
        "当前账号没有操作权限，请联系主管确认",
        erpFailureMessage(null, 403) -> 403
        else -> return this
    }
    if (!hasOriginalAuthorizationRetry()) return this
    return copy(state = "pending", message = savedRequestAuthMessage(code))
}

private fun PdaScanRecord.hasOriginalAuthorizationRetry(): Boolean {
    if (id.isBlank() || scanCode.isBlank()) return false
    if (retryAction == "post") return originalPostPayload() != null
    if (module != "inbound") return false
    return when (retryAction) {
        "arrival" -> !retryExtra.isNullOrBlank()
        "receive_box" -> (orderId ?: 0) > 0
        "scan_qc", "scan_catalog_qc" ->
            (orderId ?: 0) > 0 && (retryQuantity ?: 0) > 0 && !retryExtra.isNullOrBlank()
        else -> false
    }
}
