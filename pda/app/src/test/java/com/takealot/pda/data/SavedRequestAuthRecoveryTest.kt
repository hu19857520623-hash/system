package com.takealot.pda.data

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class SavedRequestAuthRecoveryTest {
    @Test fun preparedSubmissionRetainsAuthorizationFailures() = runBlocking {
        for (code in listOf(401, 403)) {
            var attempts = 0
            val error = runCatching {
                withSavedRequestAuthRecovery {
                    attempts++
                    parseErpResponse("""{"message":"authorization denied"}""", code)
                }
            }.exceptionOrNull() as ErpException
            assertEquals(code, error.code)
            assertEquals(1, attempts)
            assertTrue(error.retriable)
            assertTrue(error.message.orEmpty().contains("重试原请求"))
        }
    }

    @Test fun definiteBusinessRejectionsKeepTheirOriginalClassification() = runBlocking {
        for (code in listOf(400, 404, 409, 422)) {
            val error = ErpException("原请求已拒绝", code)
            val thrown = runCatching { withSavedRequestAuthRecovery { throw error } }.exceptionOrNull()
            assertSame(error, thrown)
        }
        assertEquals("saved", withSavedRequestAuthRecovery { "saved" })
    }
}
