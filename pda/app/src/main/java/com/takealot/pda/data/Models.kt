package com.takealot.pda.data

data class AuthUser(
    val id: Int = 0,
    val username: String? = "",
    val realName: String? = "",
    val roleCode: String? = "",
    val permissions: List<String>? = emptyList(),
) {
    val permSet: List<String> get() = permissions.orEmpty()
    val name: String get() = realName.orEmpty().ifBlank { username.orEmpty() }
}

data class Warehouse(
    val id: Int = 0,
    val warehouseCode: String? = "",
    val warehouseName: String? = "",
    val warehouseType: String? = "",
) {
    val code: String get() = warehouseCode.orEmpty()
    val title: String get() = warehouseName.orEmpty().ifBlank { code }
}

data class PageResult<T>(
    val items: List<T>? = emptyList(),
    val total: Int = 0,
    val page: Int = 1,
    val pageSize: Int = 20,
)

data class InboundOrder(
    val id: Int = 0,
    val inboundNo: String? = "",
    val warehouseCode: String? = "",
    val warehouseNo: String? = "",
    val trackingNo: String? = "",
    val status: String? = "",
    val displayStatus: String? = "",
    val receivedCartonCount: Int? = null,
    val items: List<InboundItem>? = emptyList(),
    val cartons: List<InboundCarton>? = emptyList(),
) {
    val itemList get() = items.orEmpty()
    val cartonList get() = cartons.orEmpty()
    val no get() = inboundNo.orEmpty()
    val statusKey get() = status.orEmpty()
    val statusText get() = inboundStatusLabel(displayStatus.orEmpty().ifBlank { statusKey })
}

data class InboundItem(
    val id: Int = 0,
    val sku: String? = "",
    val productName: String? = "",
    val expectedQty: Int = 0,
    val actualQty: Int? = null,
    val putawayQty: Int? = null,
    val qcStatus: String? = null,
    val lengthCm: Double? = null,
    val widthCm: Double? = null,
    val heightCm: Double? = null,
    val dimensionsSource: String? = null,
) {
    val skuCode get() = sku.orEmpty()
    val remainingPutaway get() = ((actualQty ?: expectedQty) - (putawayQty ?: 0)).coerceAtLeast(0)
    fun hasMeasuredDims(): Boolean {
        val treatAsMeasured = dimensionsSource == "measured" || dimensionsSource == null
        return treatAsMeasured && (lengthCm ?: 0.0) > 0 && (widthCm ?: 0.0) > 0 && (heightCm ?: 0.0) > 0
    }
}

data class InboundCarton(val id: Int = 0, val boxCode: String? = "", val status: String? = "")

data class ArrivalScanResult(
    val alreadyScanned: Boolean = false,
    val message: String? = "",
    val order: InboundOrder? = null,
)

data class ScanActionResult(
    val message: String? = "",
    val sku: String? = "",
    val increment: Int = 0,
    val expectedQty: Int = 0,
    val actualQty: Int = 0,
    val remaining: Int = 0,
    val itemId: Int = 0,
    val order: InboundOrder? = null,
)

data class OutboundOrder(
    val id: Int = 0,
    val outboundNo: String? = "",
    val warehouseCode: String? = "",
    val status: String? = "",
    val pickerId: Int? = null,
    val pickerName: String? = "",
    val customerName: String? = "",
    val skuSummary: String? = "",
    val totalQty: Int = 0,
    val omsPreDeduct: Any? = null,
    val items: List<OutboundItem>? = emptyList(),
) {
    val itemList get() = items.orEmpty()
    val no get() = outboundNo.orEmpty()
    val statusKey get() = status.orEmpty()
}

data class OutboundItem(
    val id: Int = 0,
    val sku: String? = "",
    val productName: String? = "",
    val qty: Int = 0,
    val pickedQty: Int = 0,
    val locationCode: String? = "",
)

data class PickSuggestionLine(
    val id: Int = 0,
    val sku: String? = "",
    val productName: String? = "",
    val qty: Int = 0,
    val pickedQty: Int = 0,
    val locationCode: String? = "",
    val suggestions: List<PickLocationSuggestion>? = emptyList(),
    val uncovered: Int = 0,
)

data class PickLocationSuggestion(
    val locationCode: String? = "",
    val pickQty: Int = 0,
    val available: Int = 0,
)

data class PickSuggestions(
    val outboundNo: String? = "",
    val warehouseCode: String? = "",
    val items: List<PickSuggestionLine>? = emptyList(),
) {
    val itemList get() = items.orEmpty()
}

data class LocalPickLine(
    val id: Int,
    val sku: String,
    val productName: String,
    val qty: Int,
    var locationCode: String,
    var scannedQty: Int = 0,
    val taskKey: String = "$id@$locationCode",
) {
    val done get() = scannedQty >= qty
}

class ErpException(message: String, val code: Int = -1) : RuntimeException(message)

fun inboundStatusLabel(status: String) = when (status) {
    "oms_draft" -> "OMS草稿"
    "pending_receipt", "pending_push", "push_failed", "pushed" -> "在途"
    "arrived" -> "已到仓"
    "receiving" -> "收货中"
    "pending_putaway" -> "待上架"
    "completed", "confirmed" -> "已入库"
    "exception" -> "异常"
    else -> status.ifBlank { "—" }
}

fun outboundStatusLabel(status: String) = when (status) {
    "pending_pick" -> "待拣货"
    "picking" -> "拣货中"
    "picked" -> "已拣货"
    "reviewing" -> "复核中"
    "pending_relabel" -> "待换标"
    "packed" -> "待发运"
    "shipped" -> "已发运"
    "delivered" -> "已送达"
    "exception" -> "异常"
    "cancelled" -> "已取消"
    else -> status.ifBlank { "—" }
}
