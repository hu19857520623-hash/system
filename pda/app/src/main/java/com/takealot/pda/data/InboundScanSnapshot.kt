package com.takealot.pda.data

import com.google.gson.Gson
import com.google.gson.JsonElement

internal fun JsonElement.requireExceptionReportReceipt(): JsonElement {
    val receipt = takeIf { it.isJsonObject }?.asJsonObject
    val duplicate = receipt?.get("duplicate")
    val message = receipt?.get("message")
    if (duplicate?.isJsonPrimitive != true || !duplicate.asJsonPrimitive.isBoolean ||
        message?.isJsonPrimitive != true || !message.asJsonPrimitive.isString || message.asString.isBlank()
    ) {
        throw ErpException("异常登记回执不完整，请在「待同步与异常记录」核对原请求", retriable = true)
    }
    return this
}

internal fun JsonElement.requireBoxScanReceipt(
    orderId: Int, orderNo: String?, expectedBox: String?, gson: Gson,
): ScanActionResult {
    val failure = ErpException("箱唛回执与原收箱请求不一致，请在「待同步记录」核对原请求", retriable = true)
    val body = takeIf { it.isJsonObject }?.asJsonObject ?: throw failure
    val summary = body.get("order")?.takeIf { it.isJsonObject }?.asJsonObject ?: throw failure
    fun JsonElement?.number() = this?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber }?.asString?.toIntOrNull()
    fun JsonElement?.text() = this?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString
    fun JsonElement?.flag() = this?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean }?.asBoolean
    val receipt = runCatching { gson.fromJson(this, ScanActionResult::class.java) }.getOrNull() ?: throw failure
    val no = summary.get("inboundNo").text()
    val box = receipt.carton?.boxCode
    val duplicate = body.get("duplicate").flag() ?: throw failure
    val alreadyConfirmed = body.get("alreadyConfirmed").flag() ?: throw failure
    val count = body.get("receivedCartonCount")
    val summaryCount = summary.get("receivedCartonCount")
    if (body.get("id").number() != orderId || summary.get("id").number() != orderId ||
        no.isNullOrBlank() || body.get("inboundNo").text() != no || (!orderNo.isNullOrBlank() && no != orderNo) ||
        summary.get("status").text() !in setOf("arrived", "receiving") ||
        body.get("scanType").text() != "outer_box" || box.isNullOrBlank() ||
        (expectedBox != null && !box.equals(expectedBox, ignoreCase = true)) ||
        body.get("increment").number() != (if (duplicate || alreadyConfirmed) 0 else 1)
    ) throw failure
    if (count == null || count != summaryCount || (!(alreadyConfirmed && count.isJsonNull) && (count.number() ?: 0) <= 0) ||
        body.get("syncPending").flag() != false
    ) throw failure
    return receipt
}

internal fun JsonElement.requireCartonCountReceipt(orderId: Int, orderNo: String?, count: Int): JsonElement {
    val failure = ErpException("实收箱数回执与原请求不一致，请在「待同步记录」核对原请求", retriable = true)
    val body = takeIf { it.isJsonObject }?.asJsonObject ?: throw failure
    val order = body.get("order")?.takeIf { it.isJsonObject }?.asJsonObject ?: throw failure
    fun JsonElement?.intValue() = this?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber }
        ?.asString?.toIntOrNull()
    fun JsonElement?.textValue() = this?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString
    val no = order.get("inboundNo").textValue()
    val sync = body.get("syncPending")
    if (count <= 0 || body.get("id").intValue() != orderId || order.get("id").intValue() != orderId ||
        no.isNullOrBlank() || body.get("inboundNo").textValue() != no || (!orderNo.isNullOrBlank() && no != orderNo) ||
        body.get("receivedCartonCount").intValue() != count || order.get("receivedCartonCount").intValue() != count ||
        order.get("status").textValue() != "receiving" ||
        sync?.isJsonPrimitive != true || !sync.asJsonPrimitive.isBoolean || sync.asBoolean
    ) throw failure
    return this
}

internal fun JsonElement.requireQcScanReceipt(
    orderId: Int,
    orderNo: String?,
    increment: Int,
    expectedSku: String?,
    gson: Gson,
): ScanActionResult {
    val failure = ErpException("清点或测量回执与原请求不一致，请在「待同步记录」核对原请求", retriable = true)
    val body = takeIf { it.isJsonObject }?.asJsonObject ?: throw failure
    val summary = body.get("order")?.takeIf { it.isJsonObject }?.asJsonObject ?: throw failure
    fun JsonElement?.number() = this?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber }?.asString?.toIntOrNull()
    fun JsonElement?.text() = this?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString
    fun JsonElement?.flag() = this?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean }?.asBoolean
    val receipt = runCatching { gson.fromJson(this, ScanActionResult::class.java) }.getOrNull() ?: throw failure
    val order = receipt.order ?: throw failure
    val sku = receipt.sku.orEmpty()
    val replay = body.get("duplicate").flag() ?: throw failure
    val actual = body.get("actualQty").number() ?: throw failure
    val expected = body.get("expectedQty").number() ?: throw failure
    val expectedDelta = if (replay) 0 else increment
    if (body.get("id").number() != orderId || summary.get("id").number() != orderId ||
        order.no.isBlank() || body.get("inboundNo").text() != order.no ||
        (!orderNo.isNullOrBlank() && order.no != orderNo) ||
        order.statusKey !in setOf("arrived", "receiving", "pending_putaway") ||
        body.get("sku").text().isNullOrBlank() || (expectedSku != null && !sku.equals(expectedSku, ignoreCase = true)) ||
        (body.get("itemId").number() ?: 0) <= 0 || actual < increment || expected < 0 ||
        body.get("increment").number() != expectedDelta || body.get("remaining").number() != (expected - actual).coerceAtLeast(0) ||
        body.get("syncPending").flag() != false
    ) throw failure
    return receipt
}

internal fun JsonElement.requireQcSubmitReceipt(orderId: Int?, gson: Gson): JsonElement {
    val order = runCatching { gson.fromJson(this, InboundOrder::class.java) }.getOrNull()
    val syncPending = takeIf { it.isJsonObject }?.asJsonObject?.get("syncPending")
    val syncConfirmed = syncPending?.isJsonPrimitive == true && syncPending.asJsonPrimitive.isBoolean && !syncPending.asBoolean
    if (!syncConfirmed || order == null || orderId == null || order.id != orderId || order.no.isBlank() ||
        order.statusKey !in setOf("pending_putaway", "exception") || order.itemList.isEmpty() ||
        order.itemList.any { it.id <= 0 || it.actualQty == null || it.actualQty < 0 }
    ) {
        throw ErpException("清点回执不完整，请在「待同步与异常记录」核对原请求", retriable = true)
    }
    return this
}

/** Apply only authoritative response quantities, preserving aliases and unsent local remarks. */
fun InboundOrder.withQcSnapshot(result: ScanActionResult): InboundOrder? {
    val summary = result.order ?: return null
    val item = result.item ?: return null
    if (result.duplicate || summary.id != id || summary.statusKey.isBlank() || item.id <= 0 || item.id != result.itemId) return null
    val previous = itemList.find { it.id == item.id } ?: return null
    if (!item.skuCode.equals(previous.skuCode, ignoreCase = true) || item.actualQty == null || item.actualQty < 0 || item.expectedQty < 0) return null
    return copy(
        status = summary.status, displayStatus = summary.displayStatus,
        receivingVersion = summary.receivingVersion, measurementVersion = summary.measurementVersion,
        receivedCartonCount = summary.receivedCartonCount ?: receivedCartonCount,
        items = itemList.map { old -> if (old.id != item.id) old else old.copy(
            actualQty = item.actualQty, expectedQty = item.expectedQty,
            lengthCm = item.lengthCm ?: old.lengthCm, widthCm = item.widthCm ?: old.widthCm,
            heightCm = item.heightCm ?: old.heightCm, weightKg = item.weightKg ?: old.weightKg,
            dimensionsSource = item.dimensionsSource ?: old.dimensionsSource,
        ) },
    )
}

fun InboundOrder.withCartonSnapshot(result: ScanActionResult): InboundOrder? {
    val summary = result.order ?: return null
    val carton = result.carton ?: return null
    val count = result.receivedCartonCount ?: return null
    if (result.duplicate || summary.id != id || summary.statusKey.isBlank() || count < 0 || carton.boxCode.isNullOrBlank()) return null
    if (cartonList.none { it.boxCode == carton.boxCode }) return null
    return copy(status = summary.status, displayStatus = summary.displayStatus,
        receivingVersion = summary.receivingVersion, measurementVersion = summary.measurementVersion, receivedCartonCount = count,
        cartons = cartonList.map { if (it.boxCode == carton.boxCode) it.copy(status = "received") else it })
}

fun InboundOrder.withPutawaySnapshot(result: InboundOrder): InboundOrder? {
    if (result.id != id || result.statusKey.isBlank() || result.itemList.map { it.id }.toSet() != itemList.map { it.id }.toSet()) return null
    if (result.itemList.size != itemList.size || result.itemList.any { it.putawayQty == null || it.putawayQty < 0 || (it.actualQty ?: 0) < 0 }) return null
    val byId = result.itemList.associateBy { it.id }
    if (itemList.any { !byId.getValue(it.id).skuCode.equals(it.skuCode, ignoreCase = true) }) return null
    return copy(status = result.status, displayStatus = result.displayStatus, receivingVersion = result.receivingVersion, measurementVersion = result.measurementVersion, items = itemList.map {
        val latest = byId.getValue(it.id)
        it.copy(putawayQty = latest.putawayQty, actualQty = latest.actualQty ?: it.actualQty)
    })
}
