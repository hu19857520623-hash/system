package com.takealot.pda.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PendingCommitTest {
    private fun record(mode: String, state: String = "pending", retryAction: String? = "post", orderId: Int = 7) =
        PdaScanRecord(module = "outbound", mode = mode, scanCode = "DO-1", orderId = orderId, state = state, retryAction = retryAction)

    @Test
    fun aPendingCommitBlocksASecondSubmitAndNamesTheSyncScreen() {
        val message = pendingCommitMessage(listOf(record("ship_submit")), "outbound", "ship_submit", 7)
        assertEquals("这条出库 · 提交发运的结果尚未确认。请到待同步页面使用「安全重试」，不要再次提交。", message)
    }

    @Test
    fun anotherOrderOrAFinishedRecordDoesNotBlock() {
        val records = listOf(record("ship_submit", orderId = 8), record("ship_submit", state = "acknowledged"))
        assertNull(pendingCommitMessage(records, "outbound", "ship_submit", 7))
    }

    @Test
    fun aRecordSavedBeforeTheRequestBodyUsesTheClosePath() {
        val message = pendingCommitMessage(listOf(record("pick_submit", retryAction = null)), "outbound", "pick_submit", 7)
        assertEquals(true, message!!.contains("先确认没有入账"))
    }

    @Test
    fun theSameUnboundScanCodeIsBlockedButAnotherCodeCanContinue() {
        val pending = PdaScanRecord(module = "inbound", mode = "arrival", scanCode = "RV-1", state = "pending", retryAction = "arrival")
        val message = pendingCommitMessage(listOf(pending), "inbound", "arrival", null, "rv-1")
        assertEquals(true, message!!.contains("安全重试"))
        assertNull(pendingCommitMessage(listOf(pending), "inbound", "arrival", null, "RV-2"))
    }

    @Test
    fun switchingOrdersIsBlockedWhileTheSameOrderStillHasAPendingResult() {
        val pending = PdaScanRecord(module = "inbound", mode = "putaway", scanCode = "RV-1", orderId = 3, state = "pending", retryAction = "post")
        val message = pendingSwitchMessage(listOf(pending), "inbound", 3)
        assertEquals(true, message!!.contains("再换单"))
        assertNull(pendingSwitchMessage(listOf(pending.copy(state = "failed")), "inbound", 3))
        assertEquals(true, pendingSwitchMessage(listOf(pending.copy(state = "failed", message = "原上架内容不同，不要修改后重试")), "inbound", 3)!!.contains("再换单"))
        assertNull(pendingSwitchMessage(listOf(pending), "inbound", 4))
    }

    @Test
    fun aFailedContentMismatchBlocksAnotherSubmitUntilTheRecordIsEnded() {
        val failed = record("putaway", state = "failed", retryAction = "post").copy(module = "inbound", message = "原上架操作已用于其他内容，不要修改后重试")
        val message = pendingCommitMessage(listOf(failed), "inbound", "putaway", 7)
        assertEquals(true, message!!.contains("结束本次"))
        assertNull(pendingCommitMessage(listOf(failed.copy(message = "库位不存在")), "inbound", "putaway", 7))
    }
}
