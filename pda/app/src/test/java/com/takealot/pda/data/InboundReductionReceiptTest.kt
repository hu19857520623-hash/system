package com.takealot.pda.data

import com.google.gson.JsonParser
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class InboundReductionReceiptTest {
    @Test fun requiresOriginalOperationAndQuantityForEveryReduction() {
        val request = JsonParser.parseString("""{"expectedCurrent":2,"quantity":2}""")
        for (kind in listOf("carton", "qc", "putaway")) {
            val sku = if (kind == "carton") null else "SKU-1"
            val putaway = kind == "putaway"
            val receipt = JsonParser.parseString("""
                {"id":42,"inboundNo":"RV-42","status":"${if (putaway) "pending_putaway" else "receiving"}",
                 "kind":"reduce-$kind","before":2,"after":0,"inventoryChanged":$putaway}
            """).asJsonObject
            receipt.addProperty("sku", sku)
            assertSame(receipt, receipt.verifyReductionReceipt(42, "RV-42", kind, request, sku))
            val invalid = listOf(
                receipt.deepCopy().apply { addProperty("after", 1) },
                receipt.deepCopy().apply { addProperty("inventoryChanged", !putaway) },
                receipt.deepCopy().apply { addProperty("syncPending", true) },
                receipt.deepCopy().apply { addProperty("kind", "resolve-exception") },
                receipt.deepCopy().apply { addProperty("inboundNo", "RV-43") },
            )
            for (wrong in invalid) {
                assertTrue(assertThrows(ErpException::class.java) {
                    wrong.verifyReductionReceipt(42, "RV-42", kind, request, sku)
                }.retriable)
            }
            if (sku != null) {
                assertThrows(ErpException::class.java) {
                    receipt.verifyReductionReceipt(42, "RV-42", kind, request, "OTHER-SKU")
                }
            }
        }
    }
}
