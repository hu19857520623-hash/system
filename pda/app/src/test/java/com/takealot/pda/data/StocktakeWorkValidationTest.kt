package com.takealot.pda.data

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
    @org.junit.Test fun malformedOrMismatchedReceiptRemainsRetryable() {
        val plan = StocktakePlan(id = 36, stocktakeNo = "PD-AUDIT", warehouseCode = "ZA01", status = "pending_approval", lines = listOf(StocktakeLine(id = 2043)))
        org.junit.Assert.assertSame(plan, requireStocktakeCountReceipt(plan, 36))
        for (invalid in listOf(null, plan.copy(id = 37), plan.copy(warehouseCode = null), plan.copy(lines = null), plan.copy(status = "draft"))) {
            val error = org.junit.Assert.assertThrows(ErpException::class.java) {
                requireStocktakeCountReceipt(invalid, 36)
            }
            org.junit.Assert.assertTrue(error.retriable)
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
