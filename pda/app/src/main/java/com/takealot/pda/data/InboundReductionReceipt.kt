package com.takealot.pda.data

import com.google.gson.JsonElement

internal fun JsonElement.verifyReductionReceipt(
    orderId: Int, orderNo: String?, kind: String, request: JsonElement, expectedSku: String?,
): JsonElement {
    val failure = ErpException("减少数量回执与原单或原数量不一致，请到「待同步记录」核对原请求", retriable = true)
    val payload = request.takeIf { it.isJsonObject }?.asJsonObject ?: throw failure
    val receipt = takeIf { it.isJsonObject }?.asJsonObject ?: throw failure
    fun JsonElement?.number() = this?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber }?.asString?.toIntOrNull()
    fun JsonElement?.string() = this?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString
    fun JsonElement?.flag() = this?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean }?.asBoolean
    val before = payload.get("expectedCurrent").number() ?: throw failure
    val quantity = payload.get("quantity").number() ?: throw failure
    val no = receipt.get("inboundNo").string()
    val status = receipt.get("status").string()
    val sku = receipt.get("sku").string()
    val putaway = kind == "putaway"
    val sync = receipt.get("syncPending")
    if (kind !in setOf("carton", "qc", "putaway") || quantity !in 1..before ||
        receipt.get("id").number() != orderId || no.isNullOrBlank() || (!orderNo.isNullOrBlank() && no != orderNo) ||
        receipt.get("kind").string() != "reduce-$kind" ||
        receipt.get("before").number() != before || receipt.get("after").number() != before - quantity ||
        receipt.get("inventoryChanged").flag() != putaway ||
        (sync != null && sync.flag() != false) ||
        (if (putaway) status != "pending_putaway" else status !in setOf("arrived", "receiving")) ||
        (kind != "carton" && (sku.isNullOrBlank() || (expectedSku != null && !sku.equals(expectedSku, ignoreCase = true))))
    ) throw failure
    return this
}
