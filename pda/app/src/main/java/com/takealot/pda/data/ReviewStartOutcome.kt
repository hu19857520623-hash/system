package com.takealot.pda.data

import kotlinx.coroutines.CancellationException

/** One submission at most. A questionable receipt is checked against the live order. */
internal suspend fun readReviewStartOutcome(
    original: OutboundOrder,
    checkOnly: Boolean,
    submit: suspend () -> OutboundOrder,
    read: suspend () -> OutboundOrder,
): OutboundOrder {
    fun matches(detail: OutboundOrder) =
        detail.id == original.id && detail.no == original.no && detail.warehouseCode == original.warehouseCode

    if (!checkOnly) {
        try {
            val receipt = submit()
            if (matches(receipt) && receipt.statusKey == "reviewing" && receipt.items != null) return receipt
        } catch (e: CancellationException) {
            throw e
        } catch (e: ErpException) {
            if (e.code == 401 || e.code == 403) throw e
        } catch (_: RuntimeException) {
            // The POST may have committed before its receipt failed to decode.
        }
    }

    try {
        val latest = read()
        if (matches(latest) && latest.statusKey.isNotBlank() && latest.items != null) return latest
    } catch (e: CancellationException) {
        throw e
    } catch (e: ErpException) {
        if (e.code == 401 || e.code == 403) throw e
    } catch (_: RuntimeException) {
        // Keep the original binding available for another read.
    }
    throw ErpException("暂时无法核对复核状态，请点击「核对复核状态」重试，或返回首页继续原作业", retriable = true)
}
