package com.takealot.pda.data

import com.google.gson.JsonParser
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ShipSyncAcknowledgementTest {
    @Test fun savedShipmentWithSyncWarningStillRequiresOriginalRetry() {
        val response = JsonParser.parseString("""{"id":12,"shippedAt":"2026-11-06 12:00","feePending":false,"syncPending":false,"warning":"OMS 同步未完成"}""")
        try {
            response.requireShipSyncAcknowledged(12)
            fail("未同步的发运不能确认")
        } catch (error: ErpException) {
            assertTrue(error.retriable)
            assertTrue(error.message.orEmpty().contains("发运已保存"))
        }
    }

    @Test fun pendingFlagsRequireOriginalRetryEvenWithoutWarning() {
        for (flag in listOf("feePending", "syncPending")) {
            val response = JsonParser.parseString("""{"id":12,"shippedAt":"2026-11-06 12:00","$flag":true}""")
            val error = org.junit.Assert.assertThrows(ErpException::class.java) {
                response.requireShipSyncAcknowledged(12)
            }
            assertTrue(error.retriable)
        }
    }

    @Test fun missingOrDifferentReceiptIdRequiresOriginalRetry() {
        for (body in listOf("null", "{}", """{"id":13,"shippedAt":"2026-11-06 12:00"}""", """{"id":12,"feePending":false,"syncPending":false}""")) {
            val response = JsonParser.parseString(body)
            val error = org.junit.Assert.assertThrows(ErpException::class.java) {
                response.requireShipSyncAcknowledged(12)
            }
            assertTrue(error.retriable)
            assertTrue(error.message.orEmpty().contains("核对原请求"))
        }
    }

    @Test fun matchingShipmentStillRequiresExplicitBooleanSyncConfirmation() {
        for (flags in listOf("", ",\"feePending\":false", ",\"feePending\":false,\"syncPending\":\"false\"")) {
            val response = JsonParser.parseString("""{"id":12,"shippedAt":"2026-11-06 12:00"$flags}""")
            val error = org.junit.Assert.assertThrows(ErpException::class.java) {
                response.requireShipSyncAcknowledged(12)
            }
            assertTrue(error.retriable)
            assertTrue(error.message.orEmpty().contains("同步待确认"))
        }
    }

    @Test fun confirmedShipmentKeepsItsResponse() {
        val response = JsonParser.parseString("""{"id":12,"status":"shipped","shippedAt":"2026-11-06 12:00","feePending":false,"syncPending":false}""")
        assertSame(response, response.requireShipSyncAcknowledged(12))
    }
}
