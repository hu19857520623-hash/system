package com.takealot.pda.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PickScanMatcherTest {
    private fun task(id: Int, sku: String, location: String, scanned: Int = 0) =
        LocalPickLine(id, sku, sku, 2, location, scanned, "$id@$location", "barcode-$sku", "990-$sku")

    @Test fun `can scan either SKU at the same verified location in any order`() {
        var lines = listOf(task(1, "A", "R01"), task(2, "B", "R01"))
        assertEquals("B", lines.pickTaskAtLocation("R01", "barcode-B")?.sku)
        lines = lines.map { if (it.sku == "B") it.copy(scannedQty = 2) else it }
        assertEquals("A", lines.pickTaskAtLocation("R01", "A")?.sku)
        assertNull(lines.pickTaskAtLocation("R01", "B"))
    }

    @Test fun `piece scans can alternate between SKUs before either is finished`() {
        val lines = listOf(task(1, "A", "R01", 1), task(2, "B", "R01", 1))
        assertEquals("2@R01", lines.pickTaskAtLocation(" r01 ", "B")?.taskKey)
        assertEquals("1@R01", lines.pickTaskAtLocation("R01", "A")?.taskKey)
    }

    @Test fun `same SKU across locations must use the physically scanned location`() {
        val lines = listOf(task(1, "A", "R01"), task(1, "A", "R02"), task(2, "B", "R02"))
        assertEquals("1@R02", lines.pickTaskAtLocation("R02", "barcode-A")?.taskKey)
        assertNull(lines.pickTaskAtLocation("R01", "B"))
        assertNull(lines.pickTaskAtLocation(null, "A"))
    }

    @Test fun `shortage rows cannot be picked by scanning a SKU`() {
        val lines = listOf(task(1, "A", "SHORT"))
        assertNull(lines.pickTaskAtLocation("SHORT", "A"))
    }

    @Test fun `customer SKU picks only at the verified location and keeps real task identity`() {
        val lines = listOf(task(1, "TKL005-710515-2", "R01"), task(1, "TKL005-710515-2", "R02"))
        assertEquals("1@R02", lines.pickTaskAtLocation("R02", "710515-2")?.taskKey)
        assertNull(lines.pickTaskAtLocation(null, "710515-2"))
        assertNull(lines.pickTaskAtLocation("R03", "710515-2"))
        assertEquals("TKL005-710515-2", lines.pickTaskAtLocation("R02", "710515-2")?.sku)
    }

    @Test(expected = ErpException::class) fun `ambiguous customer SKU never counts the first matching product`() {
        listOf(task(1, "TKL005-ABC", "R01"), task(2, "TKL001-ABC", "R01"))
            .pickTaskAtLocation("R01", "ABC")
    }

    @Test fun `review task matches short SKU for a known customer`() {
        val line = task(1, "AFU0430-710515-2", "R01").copy(customerCode = "AFU0430")
        assertTrue(line.matchesScan("710515-2"))
    }
}
