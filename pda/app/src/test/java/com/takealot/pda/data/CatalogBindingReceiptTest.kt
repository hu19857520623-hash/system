package com.takealot.pda.data

import com.google.gson.Gson
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogBindingReceiptTest {
    @Test fun acceptsOnlyTheOriginalOrderAndWarehouse() {
        val receipt = JsonParser.parseString("""{"id":136,"inboundNo":"RV-AUDIT","warehouseCode":"WMS-JHB-01"}""")
        assertEquals(136, catalogBindingReceipt(receipt, "rv-audit", "WMS-JHB-01", Gson()).id)
        val wrongWarehouse = assertThrows(ErpException::class.java) {
            catalogBindingReceipt(receipt, "RV-AUDIT", "WMS-CPT-01", Gson())
        }
        assertTrue(wrongWarehouse.retriable)
        val wrongOrder = assertThrows(ErpException::class.java) {
            catalogBindingReceipt(receipt, "RV-OTHER", "WMS-JHB-01", Gson())
        }
        assertTrue(wrongOrder.retriable)
    }
}
