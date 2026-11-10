package com.takealot.pda.data

import com.google.gson.JsonElement

internal data class ShipmentRequest(
    val orderId: Int,
    val orderNo: String?,
    val warehouseCode: String?,
    val logistics: Map<String, String>,
)

internal fun JsonElement.readShipmentRequest(id: Int, no: String?, warehouse: String? = null): ShipmentRequest {
    val failure = ErpException("原发运资料不完整，请由主管核对待同步记录", retriable = true)
    val payload = takeIf { it.isJsonObject }?.asJsonObject ?: throw failure
    val logistics = listOf("trackingNo", "carrier", "logisticsProduct").mapNotNull { key ->
        val field = payload.get(key) ?: return@mapNotNull null
        val value = field.text()?.trim() ?: throw failure
        if (value.isBlank()) null else key to value
    }.toMap()
    return ShipmentRequest(id, no, warehouse, logistics)
}

internal fun JsonElement.requireShipSyncAcknowledged(request: ShipmentRequest): JsonElement {
    val invalid = ErpException("发运回执与原单、物流资料或发运状态不一致，请在「待同步记录」核对原请求", retriable = true)
    val response = takeIf { it.isJsonObject }?.asJsonObject ?: throw invalid
    val id = response.get("id")?.takeIf { it.isJsonPrimitive }?.asString?.toIntOrNull()
    val no = response.get("outboundNo").text()
    val warehouse = response.get("warehouseCode").text()
    val status = response.get("status").text()
    if (id != request.orderId || no.isNullOrBlank() || (!request.orderNo.isNullOrBlank() && no != request.orderNo) ||
        warehouse.isNullOrBlank() || (request.warehouseCode != null && warehouse != request.warehouseCode) ||
        status !in setOf("shipped", "delivered", "partial_delivered", "delivery_failed", "exception") ||
        response.get("shippedAt").text().isNullOrBlank() ||
        request.logistics.any { (key, value) -> response.get(key).text() != value }
    ) throw invalid

    val syncFlags = listOf("syncPending", "feePending").map { key ->
        response.get(key)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean }?.asBoolean
    }
    if (syncFlags.any { it != false } || !response.get("warning").text().isNullOrBlank()) {
        throw ErpException("发运已保存，OMS 同步待确认。请在「待同步记录」重试原请求，勿重复发运", retriable = true)
    }
    return this
}

private fun JsonElement?.text(): String? =
    this?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString
