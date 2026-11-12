package com.takealot.pda.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PackFailureRecoveryTest {
    @Test fun finishedOrderCanLeaveTheReviewScreen() {
        assertFalse(packFailureAlreadyFinished("原复核操作对应的单据或外箱内容不同。请结束本次后再重新填写，勿修改后重试", "packed"))
        assertTrue(packFailureAlreadyFinished("当前状态不可复核（需先完成拣货）", "pending_relabel"))
    }

    @Test fun anOpenReviewStaysOnTheScreen() {
        assertFalse(packFailureAlreadyFinished("原复核操作对应的单据或外箱内容不同。请结束本次后再重新填写，勿修改后重试", "reviewing"))
        assertFalse(packFailureAlreadyFinished("网络不可用", "packed"))
    }

    @Test fun pickAndShipLeaveOnlyAfterTheOrderHasMovedOn() {
        assertEquals("DO-1 拣货已完成，请返回列表继续", outboundFinishedNotice("pick", "DO-1", "出库单状态已变化，请刷新后重试", "picked"))
        assertNull(outboundFinishedNotice("ship", "DO-1", "原发运操作对应的单据或内容不同。请结束本次后再重新填写，勿修改后重试", "shipped"))
        assertFalse(outboundProgressChanged("原发运操作对应的单据或内容不同。请结束本次后再重新填写，勿修改后重试"))
        assertTrue(outboundProgressChanged("出库单状态已变化，请重新读取最新进度"))
        assertFalse(outboundProgressChanged("请重新读取最新进度，不要修改后重试"))
        assertNull(outboundFinishedNotice("pick", "DO-1", "出库单状态已变化，请刷新后重试", "picking"))
        assertNull(outboundFinishedNotice("ship", "DO-1", "当前状态不可再次发运", "packed"))
        assertNull(outboundFinishedNotice("pick", "DO-1", "出库单状态已变化，请刷新后重试", "cancelled"))
    }
}
