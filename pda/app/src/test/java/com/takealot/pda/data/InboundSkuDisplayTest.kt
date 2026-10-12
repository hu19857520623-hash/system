package com.takealot.pda.data

import org.junit.Assert.assertEquals
import org.junit.Test

class InboundSkuDisplayTest {
    @Test fun hidesOnlyKnownCustomerPrefixAndKeepsSkuHyphens() {
        assertEquals("710695-2", inboundDisplaySku("TKL005-710695-2", "TKL005"))
        assertEquals("710695-2", inboundDisplaySku("tkl005-710695-2", " TKL005 "))
        assertEquals("710695-2", inboundDisplaySku("710695-2", "TKL005"))
    }

    @Test fun doesNotGuessCustomerOrRemoveOtherCustomersPrefix() {
        assertEquals("TKL005-710695-2", inboundDisplaySku("TKL005-710695-2", null))
        assertEquals("TKL006-710695-2", inboundDisplaySku("TKL006-710695-2", "TKL005"))
        assertEquals("TKL005-", inboundDisplaySku("TKL005-", "TKL005"))
    }

    @Test fun hidesSkuInSuccessErrorsAndUnknownBarcodeMessages() {
        assertEquals("已选 710695-2，待上架 16", inboundDisplayMessage("已选 TKL005-710695-2，待上架 16", "TKL005"))
        assertEquals("SKU 710695-2 不属于入库单", inboundDisplayMessage("SKU tkl005-710695-2 不属于入库单", "TKL005"))
        assertEquals("710695-2 +1（实收 1/16）", inboundDisplayMessage("TKL005-710695-2 +1（实收 1/16）", "TKL005"))
    }

    @Test fun leavesDocumentNumbersBarcodesAndInternalSkuSegmentsIntact() {
        val message = "RVTKL005-261009-0002 / BOX-TKL005-1 / 99012345 / 710695-TKL005-2"
        assertEquals(message, inboundDisplayMessage(message, "TKL005"))
    }

    @Test fun escapesCustomerCodeAndHandlesMultipleSkus() {
        assertEquals("ABC / DEF", inboundDisplayMessage("C.1-ABC / C.1-DEF", "C.1"))
        assertEquals("C01-ABC", inboundDisplayMessage("C01-ABC", "C.1"))
    }
}
