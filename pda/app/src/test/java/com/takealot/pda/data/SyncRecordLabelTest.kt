package com.takealot.pda.data

import org.junit.Assert.assertEquals
import org.junit.Test

class SyncRecordLabelTest {
    @Test
    fun labelsStayChineseForRecordedWarehouseActions() {
        assertEquals("入库 · 提交清点", syncRecordLabel("inbound", "qc_submit"))
        assertEquals("入库 · 核减箱数", syncRecordLabel("inbound", "reduce_carton"))
        assertEquals("入库 · 核减实收", syncRecordLabel("inbound", "reduce_qc"))
        assertEquals("出库 · 问题标记·短拣", syncRecordLabel("outbound", "problem_stock_short"))
        assertEquals("出库 · 提交发运", syncRecordLabel("outbound", "ship_submit"))
        assertEquals("盘点 · 提交盘点", syncRecordLabel("stocktake", "count_submit"))
        assertEquals("仓库作业 · 继续核对", syncRecordLabel("other", "raw_key"))
    }

    @Test
    fun retryTreatsAnAlreadyPostedResultAsConfirmed() {
        assertEquals(true, syncRetryAlreadyDone("原仓库操作已处理，本次未重复执行，请按最新单据核对"))
        assertEquals(true, syncRetryAlreadyDone("原上架操作已处理，本次未重复加库存"))
        assertEquals(false, syncRetryAlreadyDone("本次仓库操作已用于其他内容，不要修改原请求后重试"))
        assertEquals(false, syncRetryAlreadyDone("原批量库存变更内容不同，请继续原批次"))
        assertEquals(false, syncRetryAlreadyDone("网络不可用"))
        assertEquals(true, syncContentMismatch("本次仓库操作已用于其他内容，不要修改原请求后重试"))
        assertEquals(true, syncContentMismatch("请核对原操作，勿修改后重试"))
        assertEquals(false, syncRetryAlreadyDone("原仓库操作已处理，勿修改后重试"))
        assertEquals(false, syncContentMismatch("原仓库操作已处理，本次未重复执行，请按最新单据核对"))
    }
}
