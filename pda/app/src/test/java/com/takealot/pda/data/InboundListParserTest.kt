package com.takealot.pda.data

import com.google.gson.Gson
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Test

class InboundListParserTest {
    @Test
    fun mixedOmsRowsDoNotBreakOperationalInboundList() {
        val response = JsonParser.parseString("""
            {"items":[
              {"id":59,"inboundNo":"RVTKL005-261009-0001","status":"pending_putaway","readOnly":false,"items":[{"id":329,"sku":"TKL005-710672","actualQty":12}]},
              {"id":"oms-ib-1790218433617","readOnly":true},
              {"id":"60","readOnly":false},
              {"id":61,"readOnly":true},
              {"id":null},{"id":0}
            ],"total":6,"page":1,"pageSize":100}
        """.trimIndent())
        val page = parseOperationalInboundPage(response, Gson())
        assertEquals(listOf(59, 60), page.items.orEmpty().map { it.id })
        assertEquals(12, page.items!!.first().itemList.first().actualQty)
        assertEquals(6, page.total)
        assertEquals(100, page.pageSize)
        assertEquals(6, response.asJsonObject.getAsJsonArray("items").size())
    }
}
