package com.takealot.pda.data

import com.google.gson.JsonParser
import org.junit.Assert.assertSame
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class OutboundStageReceiptTest {
    @Test fun onlyTheCurrentMatchingShortPickEndsLocalPicking() {
        val original = PdaScanRecord(
            module = "outbound", mode = "problem_stock_short", scanCode = "DO-12",
            retryBodyJson = """{"problemRemark":"缺一件"}""",
        )
        val active = JsonParser.parseString("""{"isProblem":true,"problemType":"stock_short","problemRemark":"缺一件","duplicate":true}""")
        val replaced = JsonParser.parseString("""{"isProblem":true,"problemType":"stock_short","problemRemark":"缺两件","duplicate":true}""")
        val cleared = JsonParser.parseString("""{"isProblem":false,"duplicate":true}""")
        assertTrue(active.confirmsCurrentShortPick(original))
        assertFalse(replaced.confirmsCurrentShortPick(original))
        assertFalse(cleared.confirmsCurrentShortPick(original))
        assertFalse(active.confirmsCurrentShortPick(original.copy(mode = "problem_barcode_issue")))
    }

    @Test fun problemReceiptRequiresTheRequestedMarkOrExplicitReplay() {
        val marked = JsonParser.parseString("""{"id":12,"outboundNo":"DO-12","isProblem":true,"problemType":"stock_short"}""")
        assertSame(marked, marked.requireOutboundProblemReceipt(12, "stock_short"))
        val clearedAfterSubmission = JsonParser.parseString("""{"id":12,"outboundNo":"DO-12","isProblem":false,"duplicate":true}""")
        assertSame(clearedAfterSubmission, clearedAfterSubmission.requireOutboundProblemReceipt(12, "stock_short"))
        val error = assertThrows(ErpException::class.java) {
            marked.requireOutboundProblemReceipt(12, "barcode_issue")
        }
        assertTrue(error.retriable)
    }

    @Test fun acceptsFreshPickPackAndRelabelReceipts() {
        val cases = listOf(
            OutboundReceiptStage.PICK to "picked",
            OutboundReceiptStage.PACK to "packed",
            OutboundReceiptStage.PACK to "pending_relabel",
        )
        for ((stage, status) in cases) {
            val receipt = JsonParser.parseString("""{"id":12,"outboundNo":"DO-12","status":"$status"}""")
            assertSame(receipt, receipt.requireOutboundStageReceipt(12, stage))
        }
    }

    @Test fun acceptsOriginalReplayWhenTheOrderHasAlreadyAdvanced() {
        val receipt = JsonParser.parseString("""{"id":12,"outboundNo":"DO-12","status":"shipped","duplicate":true}""")
        for (stage in OutboundReceiptStage.entries) {
            assertSame(receipt, receipt.requireOutboundStageReceipt(12, stage))
        }
    }

    @Test fun leavesUncertainReceiptsPending() {
        val invalidReceipts = listOf(
            "{}",
            """{"id":13,"outboundNo":"DO-13","status":"picked","duplicate":true}""",
            """{"id":12,"status":"picked"}""",
            """{"id":12,"outboundNo":"DO-12","duplicate":true}""",
            """{"id":12,"outboundNo":"DO-12","status":"picking","duplicate":"true"}""",
        )
        for (stage in OutboundReceiptStage.entries) {
            for (body in invalidReceipts) {
                val error = assertThrows(ErpException::class.java) {
                    JsonParser.parseString(body).requireOutboundStageReceipt(12, stage)
                }
                assertTrue(error.retriable)
                assertTrue(error.message.orEmpty().contains("核对原请求"))
            }
        }
    }
}
