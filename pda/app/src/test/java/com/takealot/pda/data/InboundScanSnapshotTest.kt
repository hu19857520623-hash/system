package com.takealot.pda.data

import com.google.gson.Gson
import org.junit.Assert.*
import org.junit.Test

class InboundScanSnapshotTest {
    private val original = InboundOrder(id = 61, omsCustomerCode = "TKL005", inboundNo = "RVTEST", warehouseCode = "W",
        status = "receiving", items = listOf(InboundItem(id = 330, sku = "TKL005-710515-2", expectedQty = 16, actualQty = 1, putawayQty = 0,
            barcode = "BAR", platformBarcode = "99012345", qcRemark = "人工核对", weightKg = 2.0)),
        cartons = listOf(InboundCarton(1, "BOX-1", "pending"), InboundCarton(2, "BOX-2", "pending")))
    private fun result() = ScanActionResult(itemId = 330, actualQty = 16, expectedQty = 16,
        order = InboundOrder(id = 61, status = "receiving"), item = InboundItem(id = 330, sku = "TKL005-710515-2", expectedQty = 16, actualQty = 16))

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
