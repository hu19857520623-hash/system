package com.takealot.pda.data

import com.google.gson.JsonElement

internal enum class OutboundReceiptStage(val label: String, val acceptedStatuses: Set<String>) {
    PICK("拣货", setOf("picked")),
    PACK("复核", setOf("packed", "pending_relabel")),
}

internal fun JsonElement.requireOutboundStageReceipt(orderId: Int?, stage: OutboundReceiptStage): JsonElement {
    val receipt = takeIf { it.isJsonObject }?.asJsonObject
    val returnedId = receipt?.get("id")?.takeIf { it.isJsonPrimitive }?.asString?.toIntOrNull()
    val orderNo = receipt?.get("outboundNo")?.stringValue()
    val status = receipt?.get("status")?.stringValue()
    val duplicate = receipt?.get("duplicate")?.let {
        it.isJsonPrimitive && it.asJsonPrimitive.isBoolean && it.asBoolean
    } == true
    // A replay returns the current order, which can already have advanced past this stage.
    if (orderId == null || returnedId != orderId || orderNo.isNullOrBlank() || status.isNullOrBlank() ||
        (!duplicate && status !in stage.acceptedStatuses)
    ) {
        throw ErpException("${stage.label}回执不完整，请在「待同步与异常记录」核对原请求", retriable = true)
    }
    return this
}

private fun JsonElement.stringValue(): String? =
    takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString
