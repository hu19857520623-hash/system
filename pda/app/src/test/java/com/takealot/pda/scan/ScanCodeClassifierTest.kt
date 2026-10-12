package com.takealot.pda.scan

import org.junit.Assert.assertEquals
import org.junit.Test

class ScanCodeClassifierTest {
    @Test fun recognizesCustomerSkuWithoutPrefix() {
        listOf("710515-2", "719110", "AB-001", "TKL005-710515-2").forEach {
            assertEquals("sku", ScanCodeClassifier.classify(it).typeKey)
        }
    }

    @Test fun keepsDocumentLocationAndBarcodeTypes() {
        assertEquals("inbound_no", ScanCodeClassifier.classify("RVTKL005-261009-0003").typeKey)
        assertEquals("carton", ScanCodeClassifier.classify("RVTKL005-261009-0003-1").typeKey)
        assertEquals("location", ScanCodeClassifier.classify("JHB-A-01-03").typeKey)
        assertEquals("barcode", ScanCodeClassifier.classify("9901234567890").typeKey)
    }
}
