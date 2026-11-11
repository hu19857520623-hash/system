package com.takealot.pda.data

import org.junit.Assert.assertEquals
import org.junit.Test

class OutboundOpenFailureTest {
    @Test
    fun keepsCurrentWorkWhenAnotherOrderFailsToOpen() {
        assertEquals(
            "无法连接 ERP，请检查网络后重试；已提交操作请先核对待同步记录。当前作业已保留，请稍后重试或返回列表",
            outboundOpenFailureMessage(true, "无法连接 ERP，请检查网络后重试；已提交操作请先核对待同步记录"),
        )
    }

    @Test
    fun asksForListRetryWhenNothingWasOpen() {
        assertEquals("打开单据失败。请返回列表后重试", outboundOpenFailureMessage(false, "  "))
    }
}
