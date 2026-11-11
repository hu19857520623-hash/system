package com.takealot.pda.data

import com.google.gson.Gson
import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test

class PutawayReceiptTest {
    private val gson = Gson()
    private val payload = JsonParser.parseString(
        """{"items":[{"inboundItemId":330,"lines":[{"locationCode":"A-01","qty":1},{"locationCode":"A-02","qty":1}]}]}""",
    )
    private val request = payload.readPutawayRequest(61, "RVTEST", "W")
        .copy(expectedSkus = mapOf(330 to "SKU-1"))
    private val partial = """
        {"id":61,"inboundNo":"RVTEST","warehouseCode":"W","status":"pending_putaway","processedQty":2,"remainingQty":2,
         "items":[{"id":330,"sku":"SKU-1","actualQty":3,"putawayQty":2},{"id":331,"sku":"SKU-2","actualQty":1,"putawayQty":null}]}
    """.trimIndent()
    private val completed = """
        {"id":61,"inboundNo":"RVTEST","warehouseCode":"W","status":"completed","processedQty":2,"remainingQty":0,
         "items":[{"id":330,"sku":"SKU-1","actualQty":3,"putawayQty":3},{"id":331,"sku":"SKU-2","actualQty":1,"putawayQty":1}]}
    """.trimIndent()

    @Test fun acceptsCurrentAndHistoricalReceiptsIncludingUntouchedNullQuantity() {
        assertEquals("pending_putaway", request.verifyReceipt(JsonParser.parseString(partial), gson).statusKey)
        assertEquals("completed", request.verifyReceipt(JsonParser.parseString(completed), gson).statusKey)
        val historical = JsonParser.parseString(partial).asJsonObject.apply { addProperty("duplicate", true) }
        assertEquals(2, payload.readPutawayRequest(61, "RVTEST").verifyReceipt(historical, gson).itemList.first().putawayQty)
    }

    @Test fun wrongOrderItemOrQuantityKeepsRequestPending() {
        for (value in listOf("null", "{}", partial.replace("RVTEST", "RVOTHER"), partial.replace("""warehouseCode":"W""", """warehouseCode":"OTHER"""),
            partial.replace("330", "332"), partial.replace("SKU-1", "WRONG"),
            partial.replace("""processedQty":2""", """processedQty":1"""),
            partial.replace("""processedQty":2""", """processedQty":"2" """.trimEnd()),
            partial.replace("""remainingQty":2""", """remainingQty":0"""),
            partial.replace("pending_putaway", "completed"),
        )) {
            val error = assertThrows(ErpException::class.java) {
                request.verifyReceipt(JsonParser.parseString(value), gson)
            }
            assertTrue(error.retriable)
            assertTrue(error.message.orEmpty().contains("核对原请求"))
        }
    }

    @Test fun requestWithoutPositiveQuantityCannotBeReplayed() {
        for (value in listOf("{}", payload.toString().replace("""qty":1""", """qty":0"""))) {
            val error = assertThrows(ErpException::class.java) {
                JsonParser.parseString(value).readPutawayRequest(61, "RVTEST")
            }
            assertTrue(error.retriable)
        }
    }
}
