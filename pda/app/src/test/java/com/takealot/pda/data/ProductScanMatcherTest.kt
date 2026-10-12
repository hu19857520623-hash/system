package com.takealot.pda.data

import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test

class ProductScanMatcherTest {
    private val sku = "TKL005-710515-2"
    private fun receipt(vararg skus: String) = InboundOrder(
        omsCustomerCode = "TKL005", items = skus.mapIndexed { i, value -> InboundItem(id = i + 1, sku = value) },
    )

    @Test fun acceptsCustomerSkuFullSkuAndBoundBarcodes() {
        assertTrue(scanMatchesProduct("710515-2", sku))
        assertTrue(scanMatchesProduct(" tkl005-710515-2 ", sku))
        assertTrue(scanMatchesProduct("99012345", sku, "99012345;OTHER"))
        assertFalse(scanMatchesProduct("710515", sku))
        assertFalse(scanMatchesProduct("515-2", sku))
        assertFalse(scanMatchesProduct("TKL001-710515-2", sku))
        assertFalse(scanMatchesProduct("", sku))
    }

    @Test fun preservesCustomerSkuWithLettersHyphensAndLeadingZeros() {
        assertTrue(scanMatchesProduct("ab-001-2", "TKL0001-AB-001-2"))
        assertEquals("001-2", customerSkuForScan("TKL005-001-2"))
        assertEquals("FUR-KIT-SID-004", customerSkuForScan("FUR-KIT-SID-004"))
        assertFalse(scanMatchesProduct("KIT-SID-004", "FUR-KIT-SID-004"))
    }

    @Test fun handlesKnownNonTklCustomersWithoutGuessingSkuSegments() {
        assertTrue(scanMatchesProduct("710515-2", "AFU0430-710515-2", customerCode = "AFU0430"))
        assertFalse(scanMatchesProduct("710515-2", "AFU0430-710515-2"))
    }

    @Test fun resolvesReceiptScanToFullSkuWithoutChangingOrder() {
        val order = receipt(sku)
        assertEquals(sku, order.resolveSkuScan("710515-2"))
        assertEquals(sku, order.resolveSkuScan(sku))
        assertEquals("UNKNOWN", order.resolveSkuScan("UNKNOWN"))
        assertEquals(sku, order.itemList.single().skuCode)
    }

    @Test fun aliasesResolveToSameReceiptSku() {
        val order = InboundOrder(items = listOf(InboundItem(sku = sku, platformBarcode = "99012345")))
        assertEquals(sku, order.resolveSkuScan("99012345"))
    }

    @Test(expected = ErpException::class) fun blocksAmbiguousCustomerSku() {
        InboundOrder(items = listOf(InboundItem(sku = sku), InboundItem(sku = "TKL001-710515-2")))
            .resolveSkuScan("710515-2")
    }

    @Test fun keepsSameSkuAcrossMultipleRowsValid() {
        assertEquals(sku, receipt(sku, sku).resolveSkuScan("710515-2"))
    }

    @Test fun resolvesMeasurementLabelsWithoutDroppingDimensionsOrQuantity() {
        val order = receipt(sku)
        assertEquals("$sku|10|20|30|16", order.resolveSkuScan("710515-2;10;20;30;16"))
        val obj = JsonParser.parseString(order.resolveSkuScan("""{"sku":"710515-2","lengthCm":10,"widthCm":20,"heightCm":30,"qty":16}""")).asJsonObject
        assertEquals(sku, obj.get("sku").asString)
        assertEquals(16, obj.get("qty").asInt)
        assertEquals(30, obj.get("heightCm").asInt)
        assertEquals("{invalid", order.resolveSkuScan("{invalid"))
    }

    @Test fun stocktakeAcceptsBothLabels() {
        val line = StocktakeLine(sku = sku)
        assertTrue(line.matchesScan("710515-2"))
        assertTrue(line.matchesScan(sku))
    }
}
