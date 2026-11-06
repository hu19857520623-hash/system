package com.takealot.pda.data

import com.google.gson.JsonElement
import com.google.gson.JsonObject

internal enum class OutboundReceiptStage(val label: String, val acceptedStatuses: Set<String>) {
    PICK("拣货", setOf("picked")),
    PACK("复核", setOf("packed", "pending_relabel")),
}

internal fun JsonElement.requireOutboundStageReceipt(orderId: Int?, stage: OutboundReceiptStage): JsonElement {
    val receipt = takeIf { it.isJsonObject }?.asJsonObject
    val returnedId = receipt?.get("id")?.takeIf { it.isJsonPrimitive }?.asString?.toIntOrNull()
    val orderNo = receipt?.get("outboundNo")?.stringValue()
    val status = receipt?.get("status")?.stringValue()
    val duplicate = receipt?.hasTrueFlag("duplicate") == true
    // A replay returns the current order, which can already have advanced past this stage.
    if (orderId == null || returnedId != orderId || orderNo.isNullOrBlank() || status.isNullOrBlank() ||
        (!duplicate && status !in stage.acceptedStatuses)
    ) {
        throw ErpException("${stage.label}回执不完整，请在「待同步与异常记录」核对原请求", retriable = true)
    }
    return this
}

internal fun JsonElement.requireOutboundProblemReceipt(orderId: Int?, problemType: String): JsonElement {
    val receipt = takeIf { it.isJsonObject }?.asJsonObject
    val returnedId = receipt?.get("id")?.takeIf { it.isJsonPrimitive }?.asString?.toIntOrNull()
    val orderNo = receipt?.get("outboundNo")?.stringValue()
    val markConfirmed = receipt?.hasTrueFlag("isProblem") == true &&
        receipt.get("problemType")?.stringValue() == problemType
    if (orderId == null || returnedId != orderId || orderNo.isNullOrBlank() ||
        (!markConfirmed && receipt?.hasTrueFlag("duplicate") != true)
    ) {
        throw ErpException("问题登记回执不完整，请在「待同步与异常记录」核对原请求", retriable = true)
    }
    return this
}

private fun JsonObject.hasTrueFlag(key: String): Boolean =
    get(key)?.let { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean && it.asBoolean } == true

private fun JsonElement.stringValue(): String? =
    takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString
