package com.takealot.pda.data

import com.google.gson.JsonObject
import com.google.gson.JsonParser

/** Reuse the saved body only when its request ID and endpoint belong to this record. */
internal fun PdaScanRecord.originalPostPayload(): JsonObject? {
    if (retryAction != "post" || id.isBlank() || !hasKnownPostEndpoint()) return null
    val payload = runCatching { JsonParser.parseString(retryBodyJson.orEmpty()).asJsonObject }.getOrNull()
        ?: return null
    val key = payload.get("clientRequestId")
    if (key?.isJsonPrimitive != true || !key.asJsonPrimitive.isString || key.asString != id) return null
    if (retryEndpoint == "/inbound/catalog-bind") {
        val scan = payload.get("scanCode")
        if (scan?.isJsonPrimitive != true || !scan.asJsonPrimitive.isString || scan.asString != scanCode) return null
    }
    return payload
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
