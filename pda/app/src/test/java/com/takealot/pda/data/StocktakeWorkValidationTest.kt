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
}
