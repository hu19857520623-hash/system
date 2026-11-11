package com.takealot.pda.data

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class ReviewStartOutcomeTest {
    private val picked = OutboundOrder(id = 42, outboundNo = "OUT-42", warehouseCode = "JHB", status = "picked")
    private val reviewing = picked.copy(status = "reviewing")

    @Test fun confirmedReceiptNeedsNoRead() = runBlocking {
        assertEquals(reviewing, readReviewStartOutcome(picked, false, { reviewing }, { error("Unexpected read") }))
    }

    @Test fun lostReceiptReadsSameOrderAndNeverResubmits() = runBlocking {
        var submissions = 0
        val result = readReviewStartOutcome(picked, false, {
            submissions++
            throw ErpException("ERP 暂时不可用", 502, retriable = true)
        }, { reviewing })
        assertEquals(1, submissions)
        assertEquals(reviewing, result)
    }

    @Test fun retryOnlyReadsAndReturnsCurrentState() = runBlocking {
        for (latest in listOf(picked, reviewing, picked.copy(status = "packed"))) {
            assertEquals(latest, readReviewStartOutcome(picked, true, { error("Unexpected submission") }, { latest }))
        }
    }

    @Test fun wrongOrderOrWarehouseDoesNotUnlockScanning() = runBlocking {
        val error = runCatching {
            readReviewStartOutcome(picked, false, { reviewing.copy(id = 43) }, { reviewing.copy(warehouseCode = "DBN") })
        }.exceptionOrNull() as ErpException
        assertTrue(error.retriable)
        assertTrue(error.message.orEmpty().contains("核对复核状态"))
    }
}
