package com.takealot.pda.data

import com.google.gson.JsonParser
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ShipSyncAcknowledgementTest {
    @Test fun savedShipmentWithSyncWarningStillRequiresOriginalRetry() {
        val response = JsonParser.parseString("""{"status":"shipped","warning":"OMS 同步未完成"}""")
        try {
            response.requireShipSyncAcknowledged()
            fail("未同步的发运不能确认")
        } catch (error: ErpException) {
            assertTrue(error.retriable)
            assertTrue(error.message.orEmpty().contains("发运已保存"))
        }
    }

    @Test fun confirmedShipmentKeepsItsResponse() {
        val response = JsonParser.parseString("""{"status":"shipped","message":"OMS 同步已完成"}""")
        assertSame(response, response.requireShipSyncAcknowledged())
    }
}
