package com.takealot.pda.data

import org.junit.Assert.assertEquals
import org.junit.Test

class StatusLabelTest {
    @Test fun knownWarehouseStatusesStayChinese() {
        assertEquals("待上架", inboundStatusLabel("pending_putaway"))
        assertEquals("已取消", inboundStatusLabel("cancelled"))
        assertEquals("待拣货", outboundStatusLabel("pending_pick"))
        assertEquals("草稿", outboundStatusLabel("draft"))
        assertEquals("待审批", stocktakeStatusLabel("pending_approval"))
        assertEquals("已取消", stocktakeStatusLabel("cancelled"))
    }

    @Test fun unknownCodesDoNotShowEnglishKeys() {
        assertEquals("未知状态", inboundStatusLabel("locked"))
        assertEquals("未知状态", outboundStatusLabel("pending_payment"))
        assertEquals("未知状态", stocktakeStatusLabel("approved"))
        assertEquals("—", inboundStatusLabel(""))
        assertEquals("待上架", inboundStatusLabel("待上架"))
    }
}
