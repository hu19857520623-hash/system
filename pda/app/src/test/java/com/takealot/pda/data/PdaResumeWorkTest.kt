package com.takealot.pda.data

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
    @Test fun twoWarehousesKeepTheirOwnWorkAndOnlyRetireTheConfirmedStage() {
        val jhb = ResumeWorkScope(7, "server", "JHB")
        val cpt = ResumeWorkScope(7, "server", "CPT")
        val first = PdaResumeWork("outbound", "review", 61, "DO-61", updatedAt = 1)
        val second = PdaResumeWork("outbound", "ship", 62, "DO-62", updatedAt = 2)
        val records = cpt.activate(jhb.activate(emptyList(), first), second)
        assertEquals(61, jhb.active(records)?.orderId)
        assertEquals(62, cpt.active(records)?.orderId)
        assertNull(jhb.active(records, "outbound", "ship"))
        assertTrue(jhb.hasOtherWarehouse(records))
        val retired = jhb.clear(records, "outbound", 62, "ship")
        assertEquals(61, jhb.active(retired)?.orderId)
        assertNull(cpt.active(retired))
    }

    @Test fun ownedLegacyRecordMovesToVerifiedWarehouseOnly() {
        val gson = Gson()
        val legacy = gson.fromJson(
            """{"module":"inbound","mode":"catalog","orderId":42,"orderNo":"RV-42","ownerId":7,"serverUrl":"server"}""",
            PdaResumeWork::class.java,
        )
        val jhb = ResumeWorkScope(7, "server", "JHB")
        val cpt = ResumeWorkScope(7, "server", "CPT")
        val records = listOf(legacy)
        assertEquals(legacy, jhb.active(records))
        assertEquals(records, jhb.resolveLegacy(records, legacy, 42, "WRONG", "CPT"))
        val migrated = jhb.resolveLegacy(records, legacy, 42, "RV-42", "CPT")
        assertNull(jhb.active(migrated))
        assertEquals(42, cpt.active(migrated)?.orderId)
        val saved = gson.fromJson(gson.toJson(migrated.single()), PdaResumeWork::class.java)
        assertEquals("CPT", saved.warehouseCode)
        assertNull(ResumeWorkScope(8, "server", "CPT").active(migrated))
        assertNull(ResumeWorkScope(7, "other-server", "CPT").active(migrated))
    }
}
