package com.takealot.pda.data

import com.google.gson.Gson
import com.google.gson.JsonElement

data class PutawayIdentity(val warehouse: String?, val skus: Map<Int, String>)

internal data class PutawayRequest(
    val orderId: Int,
    val orderNo: String?,
    val warehouse: String?,
    val itemQuantities: Map<Int, Long>,
    val expectedSkus: Map<Int, String> = emptyMap(),
) {
    fun verifyReceipt(result: JsonElement, gson: Gson): InboundOrder {
        val failure = ErpException("上架回执与原请求不一致，请在「待同步与异常记录」核对原请求", retriable = true)
        val body = result.takeIf { it.isJsonObject }?.asJsonObject ?: throw failure
        val order = runCatching { gson.fromJson(result, InboundOrder::class.java) }.getOrNull() ?: throw failure
        if (order.id != orderId || order.no.isBlank() || (!orderNo.isNullOrBlank() && order.no != orderNo) ||
            order.warehouseCode.isNullOrBlank() || (warehouse != null && order.warehouseCode != warehouse) ||
            body.get("processedQty").nonnegativeInteger() != itemQuantities.values.sum()
        ) throw failure

        val items = order.itemList
        if (items.isEmpty() || items.any { it.id <= 0 || it.skuCode.isBlank() || it.actualQty == null ||
                it.actualQty < 0 || (it.putawayQty ?: 0) < 0 }) throw failure
        val byId = items.associateBy { it.id }
        if (byId.size != items.size || itemQuantities.any { (id, qty) -> (byId[id]?.putawayQty ?: 0) < qty } ||
            expectedSkus.any { (id, sku) -> !byId[id]?.skuCode.equals(sku, ignoreCase = true) }) throw failure
        val remaining = items.sumOf { it.remainingPutaway.toLong() }
        val expectedStatus = if (remaining == 0L) "completed" else "pending_putaway"
        if (order.statusKey != expectedStatus || body.get("remainingQty").nonnegativeInteger() != remaining) throw failure
        return order
    }
}

internal fun JsonElement.readPutawayRequest(orderId: Int, orderNo: String?, warehouse: String? = null): PutawayRequest {
    val quantities = runCatching {
        val groups = asJsonObject.getAsJsonArray("items")
        groups.associate { group ->
            val item = group.asJsonObject
            val id = item.get("inboundItemId").nonnegativeInteger()?.takeIf { it in 1..Int.MAX_VALUE.toLong() }
                ?: error("Missing item ID")
            val lines = item.getAsJsonArray("lines")
            val qty = lines.sumOf { line ->
                line.asJsonObject.get("qty").nonnegativeInteger()?.takeIf { it in 1..Int.MAX_VALUE.toLong() }
                    ?: error("Missing putaway quantity")
            }
            require(qty > 0)
            id.toInt() to qty
        }.also { require(it.isNotEmpty() && it.size == groups.size()) }
    }.getOrElse { throw ErpException("原上架请求缺少有效明细，请由主管核对原记录", retriable = true) }
    return PutawayRequest(orderId, orderNo, warehouse, quantities)
}

private fun JsonElement?.nonnegativeInteger(): Long? =
    this?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber }
        ?.asString?.toLongOrNull()?.takeIf { it >= 0 }
