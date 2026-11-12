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
    @Test fun legacyAuthRejectionRecoversOriginalIdentityAndPayload() {
        val original = PdaScanRecord(id = "request-1", module = "inbound", mode = "resolve_exception",
            scanCode = "RV-42", orderId = 42, orderNo = "RV-42", state = "failed", ownerId = 7,
            serverUrl = "https://erp.example/api", retryAction = "post", retryEndpoint = "/inbound/42/resolve-exception",
            retryBodyJson = """{"clientRequestId":"request-1","reason":"已核对"}""")
        for (message in listOf(erpFailureMessage(null, 401), erpFailureMessage(null, 403), "登录已过期，请重新登录", "登录已过期，请重新登录后继续未完成作业", "当前账号没有操作权限，请联系主管确认")) {
            val legacy = original.copy(message = message)
            val restored = legacy.restoreLegacyAuthorizationFailure()
            assertEquals("pending", restored.state)
            assertEquals(legacy, restored.copy(state = legacy.state, message = legacy.message))
            assertSame(restored, restored.restoreLegacyAuthorizationFailure())
        }
        val legacy = original.copy(message = erpFailureMessage(null, 403))
        for (invalid in listOf(
            legacy.copy(ownerId = null),
            legacy.copy(serverUrl = null),
            legacy.copy(retryEndpoint = "/inbound/43/resolve-exception"),
            legacy.copy(retryEndpoint = "/inbound/42/cancel"),
            legacy.copy(retryBodyJson = """{"clientRequestId":"other"}"""),
            legacy.copy(retryBodyJson = "[]"),
            legacy.copy(state = "dismissed"),
            legacy.copy(message = "原请求已拒绝"),
        )) {
            assertSame(invalid, invalid.restoreLegacyAuthorizationFailure())
        }
    }

    @Test fun incompleteHistoricalCatalogCountIsNotRecoveredWithDefaultQuantity() {
        val failed = PdaScanRecord(module = "inbound", mode = "catalog", scanCode = "SKU", orderId = 42,
            state = "failed", ownerId = 7, serverUrl = "https://erp.example/api", retryAction = "scan_catalog_qc",
            message = erpFailureMessage(null, 403))
        assertSame(failed, failed.restoreLegacyAuthorizationFailure())
        assertEquals("pending", failed.copy(retryExtra = "SKU", retryQuantity = 5).restoreLegacyAuthorizationFailure().state)
    }
    @Test fun pendingPostRequiresItsOwnRequestIdAndOrderRoute() {
        val record = PdaScanRecord(id = "request-1", module = "outbound", mode = "pick_submit",
            scanCode = "DO-42", orderId = 42, retryAction = "post", retryEndpoint = "/outbound/42/pick",
            retryBodyJson = """{"clientRequestId":"request-1","items":[]}""")
        assertEquals("request-1", record.originalPostPayload()?.get("clientRequestId")?.asString)
        assertNull(record.copy(retryBodyJson = """{"clientRequestId":"request-2"}""").originalPostPayload())
        assertNull(record.copy(retryEndpoint = "/outbound/43/pick").originalPostPayload())
        assertNull(record.copy(retryEndpoint = "/outbound/42/cancel").originalPostPayload())
        assertNull(record.copy(retryBodyJson = "broken").originalPostPayload())
        val catalog = record.copy(module = "inbound", mode = "catalog", orderId = null, scanCode = "RV-42",
            retryEndpoint = "/inbound/catalog-bind", retryBodyJson =
                """{"clientRequestId":"request-1","scanCode":"RV-42","warehouseCode":"JHB"}""")
        assertNotNull(catalog.originalPostPayload())
        assertNull(catalog.copy(scanCode = "RV-43").originalPostPayload())
    }
}
