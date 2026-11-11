package com.takealot.pda.data

import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test

class StocktakeWorkValidationTest {
    private val plan = StocktakePlan(id = 1, warehouseCode = "ZA01", status = "counting")
    @Test fun allowsCountingInCurrentWarehouse() { validateStocktakeWork(plan, "ZA01") }
    @Test fun rejectsMissingAndDifferentWarehouse() {
        for (warehouse in listOf("", "ZA02")) {
            try { validateStocktakeWork(plan, warehouse); fail("Should reject warehouse") }
            catch (e: ErpException) { assertTrue(e.message!!.contains("仓库")) }
        }
    }
    @Test fun rejectsCompletedCancelledAndApprovalPlans() {
        for (status in listOf("completed", "cancelled", "pending_approval", "")) {
            try { validateStocktakeWork(plan.copy(status = status), "ZA01"); fail("Should reject status") }
            catch (e: ErpException) { assertTrue(e.message!!.contains("任务列表")) }
        }
    }
    @Test fun receiptMatchesOriginalStageQuantityAndActorAfterLaterRecount() {
        val line = StocktakeLine(id = 2043, sku = "SKU-A", firstQty = 0, secondQty = 8,
            firstCountedBy = 42, secondCountedBy = 43, status = "matched")
        val receipt = StocktakePlan(id = 36, stocktakeNo = "PD-AUDIT", warehouseCode = "ZA01",
            status = "pending_approval", lines = listOf(line))
        val first = StocktakeCountRequest(2043, 0, "pending")
        val second = StocktakeCountRequest(2043, 8, "recount")
        assertSame(receipt, requireStocktakeCountReceipt(receipt, 36, "PD-AUDIT", first, 42, "SKU-A"))
        assertSame(receipt, requireStocktakeCountReceipt(receipt, 36, "PD-AUDIT", second, 43, "SKU-A"))

        for (bad in listOf(null, receipt.copy(id = 37), receipt.copy(stocktakeNo = "OTHER"), receipt.copy(lines = null),
            receipt.copy(warehouseCode = "OTHER"), receipt.copy(status = "draft"),
            receipt.copy(lines = listOf(line.copy(id = 2044))),
            receipt.copy(lines = listOf(line.copy(firstQty = 8))),
            receipt.copy(lines = listOf(line.copy(firstCountedBy = 43))),
            receipt.copy(lines = listOf(line.copy(sku = "SKU-B"))),
        )) {
            val error = assertThrows(ErpException::class.java) {
                requireStocktakeCountReceipt(bad, 36, "PD-AUDIT", first, 42, "SKU-A", "ZA01")
            }
            assertTrue(error.retriable)
        }
    }

    @Test fun savedRequestRequiresNonnegativeIntegerAndExplicitStage() {
        fun parse(text: String) = JsonParser.parseString(text).readStocktakeCountRequest()
        assertEquals(StocktakeCountRequest(2043, 0, "pending"), parse("""{"lineId":2043,"qty":0,"expectedStage":"pending"}"""))
        for (bad in listOf("""{"lineId":2043,"qty":-1,"expectedStage":"pending"}""",
            """{"lineId":2043,"qty":"1","expectedStage":"pending"}""", """{"lineId":2043,"qty":1}""")) {
            assertThrows(ErpException::class.java) { parse(bad) }
        }
    }

    @Test fun exitOnlyWhenPlanIsClosedOrEveryRemainingLineNeedsAnotherCounter() {
        val ownRecount = StocktakeLine(id = 1, status = "recount", firstCountedBy = 42)
        val waiting = plan.copy(lines = listOf(ownRecount, StocktakeLine(id = 2, status = "matched")))
        assertTrue(waiting.countExitMessage(42).orEmpty().contains("另一名作业员"))
        assertNull(waiting.countExitMessage(43))
        assertNull(waiting.copy(lines = waiting.lineList + StocktakeLine(id = 3, status = "pending")).countExitMessage(42))
        assertTrue(waiting.copy(status = "pending_approval").countExitMessage(42).orEmpty().contains("等待审批"))
    }
}
