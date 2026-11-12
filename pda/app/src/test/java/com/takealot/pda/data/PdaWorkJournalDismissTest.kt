package com.takealot.pda.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PdaWorkJournalDismissTest {
    private fun record(state: String, retryAction: String? = null, message: String? = null) =
        PdaScanRecord(module = "inventory", mode = "change", scanCode = "SKU-A", state = state, retryAction = retryAction, message = message)

    @Test fun failedRecordsCanBeDismissed() {
        assertTrue(canDismissRecord(record("failed", retryAction = "库存变更", message = "网络中断，结果待确认"), visible = true))
    }

    @Test fun pendingUnknownWithoutRetryActionCanBeDismissed() {
        assertTrue(canDismissRecord(record("pending", retryAction = null, message = null), visible = true))
    }

    @Test fun pendingSafeRetryKeepsContinueEntry() {
        // 结果待确认且可安全重试：不得删除卡片，继续入口必须保留
        assertFalse(canDismissRecord(record("pending", retryAction = "库存变更", message = "网络超时，结果待确认"), visible = true))
    }

    @Test fun pendingContentMismatchCanCloseAfterAcknowledgement() {
        assertTrue(canDismissRecord(record("pending", retryAction = "库存变更", message = "原批次库存变更内容不同，请核对原请求"), visible = true))
    }

    @Test fun otherAccountsRecordsCannotBeDismissed() {
        assertFalse(canDismissRecord(record("failed"), visible = false))
    }

    @Test fun completedRecordsAreNotDismissTargets() {
        assertFalse(canDismissRecord(record("completed"), visible = true))
        assertFalse(canDismissRecord(record("dismissed"), visible = true))
    }

    @Test fun dismissedRecordsReportManualAcknowledgementMessage() {
        // 关闭语义由 update 置为「已人工确认」，此测保证状态机不把 dismissed 再当待办
        val dismissed = record("dismissed", message = "已人工确认")
        assertEquals("已人工确认", dismissed.message)
        assertFalse(canDismissRecord(dismissed, visible = true))
    }
}
