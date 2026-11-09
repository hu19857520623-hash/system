package com.takealot.pda.data

import com.google.gson.Gson
import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test

class InboundScanSnapshotTest {
    @Test fun exceptionReportRequiresAnExplicitReceiptOnInitialAndRepeatedRequests() {
        for (duplicate in listOf(false, true)) {
            val receipt = JsonParser.parseString("""{"message":"未知条码已登记","duplicate":$duplicate}""")
            assertSame(receipt, receipt.requireExceptionReportReceipt())
        }
        for (body in listOf("null", "{}", """{"message":"未知条码已登记"}""",
            """{"message":"未知条码已登记","duplicate":"false"}""")) {
            val error = assertThrows(ErpException::class.java) {
                JsonParser.parseString(body).requireExceptionReportReceipt()
            }
            assertTrue(error.retriable)
        }
    }

    @Test fun qcReceiptRequiresMatchingCountAndExplicitSyncConfirmation() {
        val gson = Gson()
        for (status in listOf("pending_putaway", "exception")) {
            val body = """{"id":61,"inboundNo":"RVTEST","status":"$status","syncPending":false,"items":[{"id":330,"actualQty":0}]}"""
            val receipt = JsonParser.parseString(body)
            assertSame(receipt, receipt.requireQcSubmitReceipt(61, gson))
            for (invalid in listOf(body.replace("false", "\"false\""), body.replace("\"actualQty\":0", "\"actualQty\":null"),
                body.replace("\"id\":61", "\"id\":62"))) {
                val error = assertThrows(ErpException::class.java) {
                    JsonParser.parseString(invalid).requireQcSubmitReceipt(61, gson)
                }
                assertTrue(error.retriable)
            }
        }
    }

    private val original = InboundOrder(id = 61, omsCustomerCode = "TKL005", inboundNo = "RVTEST", warehouseCode = "W",
        status = "receiving", items = listOf(InboundItem(id = 330, sku = "TKL005-710515-2", expectedQty = 16, actualQty = 1, putawayQty = 0,
            barcode = "BAR", platformBarcode = "99012345", qcRemark = "人工核对", weightKg = 2.0)),
        cartons = listOf(InboundCarton(1, "BOX-1", "pending"), InboundCarton(2, "BOX-2", "pending")))
    private fun result() = ScanActionResult(itemId = 330, actualQty = 16, expectedQty = 16,
        order = InboundOrder(id = 61, status = "receiving"), item = InboundItem(id = 330, sku = "TKL005-710515-2", expectedQty = 16, actualQty = 16))

    @Test fun putawayReceiptConfirmsPartialAndCompletedWork() {
        for (status in listOf("pending_putaway", "completed")) {
            val receipt = original.copy(status = status)
            assertSame(receipt, requirePutawayReceipt(receipt, original.id))
        }
    }

    @Test fun incompletePutawayReceiptLeavesTheRequestPending() {
        val receipt = original.copy(status = "pending_putaway")
        for (invalid in listOf(null, receipt.copy(id = 62), receipt.copy(items = emptyList()),
            receipt.copy(items = receipt.itemList.map { it.copy(putawayQty = null) }))) {
            val error = assertThrows(ErpException::class.java) { requirePutawayReceipt(invalid, original.id) }
            assertTrue(error.retriable)
            assertTrue(error.message.orEmpty().contains("核对原请求"))
        }
    }

    @Test fun updatesServerCountWithoutLosingAliasesRemarksOrCustomerIdentity() {
        val updated = original.withQcSnapshot(result())!!
        val item = updated.itemList.single()
        assertEquals(16, item.actualQty)
        assertEquals("BAR", item.barcode)
        assertEquals("99012345", item.platformBarcode)
        assertEquals("人工核对", item.qcRemark)
        assertEquals(2.0, item.weightKg!!, 0.0)
        assertEquals("TKL005", updated.omsCustomerCode)
        assertEquals(1, original.itemList.single().actualQty)
    }

    @Test fun missingDuplicateOrWrongOrderRequiresFullRefresh() {
        assertNull(original.withQcSnapshot(ScanActionResult()))
        assertNull(original.withQcSnapshot(result().copy(duplicate = true)))
        assertNull(original.withQcSnapshot(result().copy(order = InboundOrder(id = 62, status = "receiving"))))
        assertNull(original.withQcSnapshot(result().copy(item = result().item!!.copy(actualQty = -1))))
    }

    @Test fun parsesActualServerShapeAndPreservesMeasurementUpdates() {
        val response = Gson().fromJson("""{"itemId":330,"actualQty":16,"expectedQty":16,"item":{"id":330,"sku":"TKL005-710515-2","expectedQty":16,"actualQty":16,"lengthCm":10,"widthCm":20,"heightCm":30,"dimensionsSource":"measured"},"order":{"id":61,"inboundNo":"RVTEST","status":"receiving"}}""", ScanActionResult::class.java)
        val updated = original.withQcSnapshot(response)!!
        assertEquals(16, updated.itemList.single().actualQty)
        assertTrue(updated.itemList.single().hasMeasuredDims())
    }

    @Test fun cartonSnapshotOnlyChangesTheConfirmedBoxNotSkuCounts() {
        val updated = original.withCartonSnapshot(ScanActionResult(receivedCartonCount = 1, carton = InboundCarton(boxCode = "BOX-1"), order = InboundOrder(id = 61, status = "receiving")))!!
        assertEquals(1, updated.receivedCartonCount)
        assertEquals("received", updated.cartonList[0].status)
        assertEquals("pending", updated.cartonList[1].status)
        assertEquals(original.items, updated.items)
        assertNull(original.withCartonSnapshot(ScanActionResult()))
    }

    @Test fun putawayResponsePreservesBarcodesAndAppliesCompletionStatus() {
        val response = InboundOrder(id = 61, status = "completed", items = listOf(InboundItem(id = 330, sku = "TKL005-710515-2", actualQty = 16, putawayQty = 16)))
        val updated = original.withPutawaySnapshot(response)!!
        assertEquals("completed", updated.statusKey)
        assertEquals(16, updated.itemList.single().putawayQty)
        assertEquals("99012345", updated.itemList.single().platformBarcode)
        assertEquals(0, updated.itemList.single().remainingPutaway)
        assertNull(original.withPutawaySnapshot(response.copy(items = emptyList())))
        assertNull(original.withPutawaySnapshot(response.copy(items = response.itemList + response.itemList)))
        assertNull(original.withPutawaySnapshot(response.copy(items = listOf(response.itemList.single().copy(sku = "OTHER")))))
        assertNull(original.withPutawaySnapshot(response.copy(items = listOf(response.itemList.single().copy(actualQty = -1)))))
    }
}
