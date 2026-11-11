package com.takealot.pda.data

import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test

class ShipSyncAcknowledgementTest {
    private val request = JsonParser.parseString(
        """{"trackingNo":"AUD-12","carrier":"审计承运商","logisticsProduct":"卡派"}""",
    ).readShipmentRequest(12, "DO-AUD-12", "JHB")

    private fun receipt() = JsonParser.parseString("""
        {"id":12,"outboundNo":"DO-AUD-12","warehouseCode":"JHB","status":"shipped","shippedAt":"2026-11-06 12:00",
         "trackingNo":"AUD-12","carrier":"审计承运商","logisticsProduct":"卡派","feePending":false,"syncPending":false}
    """).asJsonObject

    @Test fun pendingFlagsOrWarningKeepOriginalRequest() {
        val uncertain = listOf(
            receipt().apply { addProperty("warning", "OMS 同步未完成") },
            receipt().apply { addProperty("feePending", true) },
            receipt().apply { addProperty("syncPending", true) },
            receipt().apply { remove("feePending") },
            receipt().apply { addProperty("syncPending", "false") },
        )
        for (body in uncertain) {
            val error = assertThrows(ErpException::class.java) { body.requireShipSyncAcknowledged(request) }
            assertTrue(error.retriable)
            assertTrue(error.message.orEmpty().contains("同步待确认"))
        }
    }

    @Test fun wrongOrderLogisticsOrStageCannotConfirmShipment() {
        for (field in listOf("id", "outboundNo", "warehouseCode", "status", "shippedAt", "trackingNo", "carrier", "logisticsProduct")) {
            val body = receipt().apply { addProperty(field, "wrong") }
            if (field == "shippedAt") body.remove(field)
            val error = assertThrows(ErpException::class.java) { body.requireShipSyncAcknowledged(request) }
            assertTrue(error.retriable)
            assertTrue(error.message.orEmpty().contains("核对原请求"))
        }
    }

    @Test fun acceptsLaterDeliveryStagesAndAllowsUnspecifiedLogisticsToBeInherited() {
        val unspecified = JsonParser.parseString("""{"trackingNo":"","carrier":"  "}""").readShipmentRequest(12, "DO-AUD-12")
        for (status in listOf("shipped", "delivered", "partial_delivered", "delivery_failed", "exception")) {
            val body = receipt().apply { addProperty("status", status) }
            assertSame(body, body.requireShipSyncAcknowledged(request))
            assertSame(body, body.requireShipSyncAcknowledged(unspecified))
        }
    }

    @Test fun rejectsCorruptSavedLogisticsBeforeRetry() {
        assertThrows(ErpException::class.java) {
            JsonParser.parseString("""{"trackingNo":123}""").readShipmentRequest(12, "DO-AUD-12")
        }
    }
}
