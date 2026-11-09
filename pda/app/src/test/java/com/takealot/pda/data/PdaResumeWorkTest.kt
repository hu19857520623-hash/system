package com.takealot.pda.data

import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PdaResumeWorkTest {
    private val work = PdaResumeWork("inbound", "catalog", 42, "RV-42")

    @Test fun matchingOrderCanResumeInItsWarehouse() {
        work.requireMatchingDetail(42, "WMS-JHB-01", "WMS-JHB-01")
    }

    @Test fun differentOrderOrMissingWarehouseRequiresRetryFromHome() {
        for ((id, warehouse) in listOf(43 to "WMS-JHB-01", 42 to null, 42 to " ")) {
            val error = assertThrows(ErpException::class.java) {
                work.requireMatchingDetail(id, warehouse, "WMS-JHB-01")
            }
            assertTrue(error.message.orEmpty().contains("未完成作业已保留"))
        }
    }

    @Test fun differentWarehousePromptsSwitchingToTheOrdersWarehouse() {
        val error = assertThrows(ErpException::class.java) {
            work.requireMatchingDetail(42, "WMS-CPT-01", "WMS-JHB-01")
        }
        assertTrue(error.message.orEmpty().contains("WMS-CPT-01"))
        assertTrue(error.message.orEmpty().contains("切换作业仓库"))
    }
}
