package com.takealot.pda.data

import com.google.gson.JsonParser

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
        "登录已过期，请重新登录", erpFailureMessage(null, 401) -> 401
        erpFailureMessage(null, 403) -> 403
        else -> return this
    }
    if (!hasOriginalAuthorizationRetry()) return this
    return copy(state = "pending", message = savedRequestAuthMessage(code))
}

private fun PdaScanRecord.hasOriginalAuthorizationRetry(): Boolean {
    if (id.isBlank() || scanCode.isBlank()) return false
    if (retryAction == "post") {
        if (!hasKnownPostEndpoint()) return false
        return runCatching {
            val body = JsonParser.parseString(retryBodyJson.orEmpty()).asJsonObject
            val key = body.get("clientRequestId")
            key?.isJsonPrimitive == true && key.asJsonPrimitive.isString && key.asString == id
        }.getOrDefault(false)
    }
    if (module != "inbound") return false
    return when (retryAction) {
        "arrival" -> !retryExtra.isNullOrBlank()
        "receive_box" -> (orderId ?: 0) > 0
        "scan_qc", "scan_catalog_qc" ->
            (orderId ?: 0) > 0 && (retryQuantity ?: 0) > 0 && !retryExtra.isNullOrBlank()
        else -> false
    }
}

private fun PdaScanRecord.hasKnownPostEndpoint(): Boolean {
    if (module == "inbound" && retryEndpoint == "/inbound/catalog-bind") {
        return !catalogBindingWarehouse.isNullOrBlank()
    }
    val id = orderId?.takeIf { it > 0 } ?: return false
    val endpoint = retryEndpoint ?: return false
    val operation = endpoint.substringAfterLast('/')
    return when (module) {
        "inbound" -> endpoint == "/inbound/$id/$operation" && operation in setOf(
            "putaway", "qc", "scan-qc", "measure-dimensions", "resolve-exception", "received-carton-count",
            "report-exception", "reduce-carton", "reduce-qc", "reduce-putaway",
        )
        "outbound" -> endpoint == "/outbound/$id/$operation" && operation in setOf("pick", "pack", "problem", "ship")
        "stocktake" -> endpoint == "/management-loop/stocktakes/$id/count"
        else -> false
    }
}
