package com.takealot.pda.data

/** Apply only authoritative response quantities, preserving aliases and unsent local remarks. */
fun InboundOrder.withQcSnapshot(result: ScanActionResult): InboundOrder? {
    val summary = result.order ?: return null
    val item = result.item ?: return null
    if (result.duplicate || summary.id != id || summary.statusKey.isBlank() || item.id <= 0 || item.id != result.itemId) return null
    val previous = itemList.find { it.id == item.id } ?: return null
    if (!item.skuCode.equals(previous.skuCode, ignoreCase = true) || item.actualQty == null || item.actualQty < 0 || item.expectedQty < 0) return null
    return copy(
        status = summary.status, displayStatus = summary.displayStatus,
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
    return copy(status = summary.status, displayStatus = summary.displayStatus, receivedCartonCount = count,
        cartons = cartonList.map { if (it.boxCode == carton.boxCode) it.copy(status = "received") else it })
}

fun InboundOrder.withPutawaySnapshot(result: InboundOrder): InboundOrder? {
    if (result.id != id || result.statusKey.isBlank() || result.itemList.map { it.id }.toSet() != itemList.map { it.id }.toSet()) return null
    if (result.itemList.size != itemList.size || result.itemList.any { it.putawayQty == null || it.putawayQty < 0 || (it.actualQty ?: 0) < 0 }) return null
    val byId = result.itemList.associateBy { it.id }
    if (itemList.any { !byId.getValue(it.id).skuCode.equals(it.skuCode, ignoreCase = true) }) return null
    return copy(status = result.status, displayStatus = result.displayStatus, items = itemList.map {
        val latest = byId.getValue(it.id)
        it.copy(putawayQty = latest.putawayQty, actualQty = latest.actualQty ?: it.actualQty)
    })
}
