package com.takealot.pda.data

import org.junit.Assert.assertEquals
import org.junit.Test

class QcSubmissionStatusTest {
    @Test fun pendingAfterQuantityCorrectionCanSubmit() {
        assertEquals("pass", qcSubmissionStatus("pending"))
        assertEquals("pass", qcSubmissionStatus(null))
        assertEquals("pass", qcSubmissionStatus("pass"))
        assertEquals("fail", qcSubmissionStatus("fail"))
    }
}
