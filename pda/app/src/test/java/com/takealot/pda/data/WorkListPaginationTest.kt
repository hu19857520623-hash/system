package com.takealot.pda.data

import org.junit.Assert.*
import org.junit.Test
import org.junit.Assume.assumeNotNull
import com.google.gson.Gson
import com.google.gson.JsonParser
import java.io.File

class WorkListPaginationTest {
    @Test fun `real isolated API pages retain every warehouse scoped inbound and review order`() {
        val path = System.getenv("PDA_PAGING_FIXTURE")
        assumeNotNull(path)
        val fixture = JsonParser.parseString(File(path!!).readText()).asJsonObject
        val pages = fixture.getAsJsonObject("pages")
        val gson = Gson()
        var inbound = WorkListPage(emptyList<InboundOrder>(), 1, true)
        for ((index, value) in pages.getAsJsonArray("inbound").withIndex()) {
            inbound = mergeWorkListPages(inbound.items, listOf(parseOperationalInboundPage(value, gson)), index + 1, { it.id }) { it.warehouseCode == "WMS-JHB-01" }
        }
        assertEquals(fixture.get("expectedInbound").asInt, inbound.items.size)
        assertFalse(inbound.hasMore)
        var outbound = WorkListPage(emptyList<OutboundOrder>(), 1, true)
        for (index in 0..1) {
            val statuses = listOf("picked", "reviewing").map { parseOutboundPage(pages.getAsJsonArray(it)[index], gson) }
            outbound = mergeWorkListPages(outbound.items, statuses, index + 1, { it.id }) { it.warehouseCode == "WMS-JHB-01" && !it.isProblem }
        }
        assertEquals(fixture.get("expectedReview").asInt, outbound.items.size)
        assertFalse(outbound.hasMore)
    }

    @Test fun `all 205 orders remain selectable across three pages`() {
        var result = WorkListPage(emptyList<Int>(), 1, true)
        for (page in 1..3) {
            val rows = ((page - 1) * 100 + 1..minOf(page * 100, 205)).toList()
            result = mergeWorkListPages(result.items, listOf(PageResult(rows, 205, page, 100)), page, { it })
            assertEquals(page + 1, result.nextPage)
            assertEquals(page < 3, result.hasMore)
        }
        assertEquals((1..205).toList(), result.items)
    }

    @Test fun `filtered empty page still allows the next page and updates duplicate details`() {
        data class Row(val id: Int, val allowed: Boolean, val quantity: Int = 1)
        val first = mergeWorkListPages(emptyList(), listOf(PageResult(listOf(Row(1, false)), 3, 1, 1)), 1, { it.id }) { it.allowed }
        assertTrue(first.items.isEmpty())
        assertTrue(first.hasMore)
        val second = mergeWorkListPages(first.items, listOf(PageResult(listOf(Row(2, true)), 3, 2, 1)), 2, { it.id }) { it.allowed }
        val third = mergeWorkListPages(second.items, listOf(PageResult(listOf(Row(2, true, 9)), 3, 3, 1)), 3, { it.id }) { it.allowed }
        assertEquals(listOf(Row(2, true, 9)), third.items)
        assertFalse(third.hasMore)
    }

    @Test fun `two review statuses commit together and an invalid next page leaves the previous list intact`() {
        val existing = listOf(1, 2)
        val firstStatus = PageResult(listOf(3), 60, 2, 50)
        val wrongStatusPage = PageResult(listOf(4), 51, 1, 50)
        try {
            mergeWorkListPages(existing, listOf(firstStatus, wrongStatusPage), 2, { it })
            fail("Wrong page must be rejected")
        } catch (e: ErpException) { assertTrue(e.message.orEmpty().contains("请刷新列表")) }
        assertEquals(listOf(1, 2), existing)
        val retried = mergeWorkListPages(existing, listOf(firstStatus, wrongStatusPage.copy(page = 2)), 2, { it })
        assertEquals(listOf(1, 2, 3, 4), retried.items)
        assertFalse(retried.hasMore)
    }
}
