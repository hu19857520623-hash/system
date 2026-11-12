package com.takealot.pda.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class InboundStepRecoveryTest {
    @Test fun finishedStepsLeaveTheCurrentScreen() {
        assertEquals("IN-1 清点已提交，请按最新单据继续上架", inboundStepFinished("qc", "IN-1", "当前状态「待上架」不可重复清点", "pending_putaway"))
        assertEquals("IN-1 上架已完成，请返回列表继续下一单", inboundStepFinished("putaway", "IN-1", "该入库单已完结", "completed"))
        assertEquals("IN-1 异常已处理，请按最新单据继续", inboundStepFinished("resolve", "IN-1", "原处理已完成，本次未重复修改，请按最新单据继续", "pending_putaway"))
        assertEquals("IN-1 实收箱数已登记，请按最新单据继续", inboundStepFinished("carton", "IN-1", "原仓库操作已处理，本次未重复执行，请按最新单据核对", "receiving", 3))
    }

    @Test fun anOpenStepStaysForCorrection() {
        assertNull(inboundStepFinished("qc", "IN-1", "原上架操作对应的内容不同，请先核对原操作，不要修改后重试", "receiving"))
        assertNull(inboundStepFinished("qc", "IN-1", "原上架操作对应的内容不同。请结束本次后再重新填写，不要修改后重试", "pending_putaway"))
        assertNull(inboundStepFinished("qc", "IN-1", "请核对原操作，勿修改后重试", "pending_putaway"))
        assertFalse(inboundProgressChanged("请核对原操作，勿修改后重试"))
        assertTrue(inboundProgressChanged("实收、已上架数量或实测尺寸已变更，请重新读取最新进度后上架"))
        assertFalse(inboundProgressChanged("请重新读取最新进度，不要修改后重试"))
        assertNull(inboundStepFinished("putaway", "IN-1", "实收、已上架数量或实测尺寸已变更，请重新读取最新进度后上架", "pending_putaway"))
        assertNull(inboundStepFinished("resolve", "IN-1", "当前状态不可放行", "exception"))
        assertNull(inboundStepFinished("carton", "IN-1", "原仓库操作已处理，本次未重复执行", "arrived", 0))
        assertNull(inboundStepFinished("qc", "IN-1", "网络不可用", "pending_putaway"))
    }

    @Test fun savedMeasurementContinuesFromTheRecordedSize() {
        assertNull(measureRecovery("原上架操作对应的内容不同。请结束本次后再重新填写，不要修改后重试", true))
        assertEquals(MeasureRecovery.Saved, measureRecovery("原仓库操作已处理，本次未重复执行，请按最新单据核对", true))
        assertEquals(MeasureRecovery.Reload, measureRecovery("实收、已上架数量或实测尺寸已变更，请重新读取最新进度后上架", false))
        assertNull(measureRecovery("不要修改后重试", false))
        assertNull(measureRecovery("请按最新单据核对，勿修改后重试", true))
        assertNull(measureRecovery("网络不可用", true))
    }

    @Test fun arrivalContinuesWhenTheOrderIsAlreadyAtTheWarehouse() {
        assertEquals("该单已到仓，请继续确认箱数", arrivalAlreadyProgressed("该入库单已到仓，请勿重复扫描", "arrived"))
        assertEquals("该单已完成到仓，请返回列表按当前状态继续", arrivalAlreadyProgressed("当前状态「待上架」不可再次到仓", "pending_putaway"))
        assertNull(arrivalAlreadyProgressed("该入库单已到仓", "pending_receipt"))
        assertNull(arrivalAlreadyProgressed("本次到仓扫描已用于其他内容。请结束本次后再重新填写，不要修改后重试", "arrived"))
        assertNull(arrivalAlreadyProgressed("当前状态不可再次到仓，勿修改后重试", "pending_putaway"))
        assertNull(arrivalAlreadyProgressed("网络不可用", "arrived"))
    }

    @Test fun recordedCartonScanContinues() {
        assertTrue(receiveScanAlreadyRecorded("原仓库操作已处理，本次未重复执行，请按最新单据核对"))
        assertFalse(receiveScanAlreadyRecorded("本次仓库操作已用于其他内容，请先核对原操作，不要修改原请求后重试"))
        assertFalse(receiveScanAlreadyRecorded("原仓库操作已处理，勿修改后重试"))
        assertFalse(receiveScanAlreadyRecorded("网络不可用"))
    }
}
