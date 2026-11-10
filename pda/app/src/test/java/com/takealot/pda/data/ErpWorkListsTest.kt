package com.takealot.pda.data

import com.google.gson.Gson
import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test

class ErpWorkListsTest {
    private val gson = Gson()
    private fun json(value: String) = JsonParser.parseString(value)

    @Test fun actualEmptyListsAreValid() {
        assertTrue(parseWarehouseList(json("[]"), gson).isEmpty())
        assertTrue(parseWarehouseList(json("""{"items":[]}"""), gson).isEmpty())
        assertTrue(parseStocktakeList(json("[]"), gson).isEmpty())
        assertTrue(parseOutboundPage(json("""{"items":[]}"""), gson).items.orEmpty().isEmpty())
    }

    @Test fun warehouseSupportsDirectAndWrappedListFormats() {
        val rows = """[{"warehouseCode":"WMS-JHB-01","warehouseName":"约堡仓"}]"""
        for (data in listOf(rows, """{"items":$rows}""")) {
            assertEquals("WMS-JHB-01", parseWarehouseList(json(data), gson).single().code)
        }
    }

    @Test fun stocktakeAndOutboundRetainOrderIdentity() {
        val plans = """[{"id":4,"stocktakeNo":"PD-04","status":"counting"}]"""
        val outbound = """{"items":[{"id":9,"outboundNo":"DO-09","status":"picked"}],"total":11}"""
        assertEquals("PD-04", parseStocktakeList(json(plans), gson).single().no)
        val page = parseOutboundPage(json(outbound), gson)
        assertEquals("DO-09", page.items.orEmpty().single().no)
        assertEquals(11, page.total)
    }

    @Test fun malformedListsReturnChineseRetryableErrors() {
        for (value in listOf("null", "{}", """{"items":null}""", """{"items":[null]}""", """{"items":[{}]}""")) {
            assertListFailure("仓库列表") { parseWarehouseList(json(value), gson) }
            assertListFailure("出库作业列表") { parseOutboundPage(json(value), gson) }
        }
        for (value in listOf("null", "{}", "[null]", "[{}]", """[{"id":"bad","stocktakeNo":"PD-04"}]""")) {
            assertListFailure("盘点任务列表") { parseStocktakeList(json(value), gson) }
        }
    }

    private fun assertListFailure(label: String, action: () -> Unit) {
        val error = assertThrows(ErpException::class.java) { action() }
        assertTrue(error.retriable)
        assertEquals("${label}数据不完整，请重试", error.message)
    }
}
